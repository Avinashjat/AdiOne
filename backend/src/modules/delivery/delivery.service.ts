/**
 * Delivery (Phase 10).
 *
 * V1 is deliberately manual: one store with two or three riders, where a human
 * assigns better than any algorithm could. The DATA MODEL, however, is already
 * shaped for the V2 rider app — `delivery_agents.user_id`, the assignment
 * status ladder (ASSIGNED → ACCEPTED → PICKED_UP → DELIVERED) and the
 * `DELIVERY_AGENT` role all exist, so adding the app needs no schema change
 * (Task 10.2).
 */

import { DeliveryAssignmentStatus, ErrorCode, type DeliveryAgentDto } from '../../shared';
import { AppError } from '../../common/errors';
import { prisma, runInTransaction } from '../../infra/db/prisma';
import { ACTIVE_ORDER_STATUSES } from '../../shared';

export async function listAgents(storeId: string): Promise<DeliveryAgentDto[]> {
  const agents = await prisma.deliveryAgent.findMany({
    where: { storeId, deletedAt: null },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    include: {
      _count: {
        select: {
          assignments: {
            where: {
              status: {
                in: [
                  DeliveryAssignmentStatus.ASSIGNED,
                  DeliveryAssignmentStatus.ACCEPTED,
                  DeliveryAssignmentStatus.PICKED_UP,
                ],
              },
            },
          },
        },
      },
    },
  });

  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    mobile: agent.mobile,
    vehicleNumber: agent.vehicleNumber,
    isActive: agent.isActive,
    isAvailable: agent.isAvailable,
    activeOrderCount: agent._count.assignments,
  }));
}

export async function createAgent(
  storeId: string,
  input: { name: string; mobile: string; vehicleNumber?: string | null },
): Promise<{ id: string }> {
  const existing = await prisma.deliveryAgent.findUnique({ where: { mobile: input.mobile } });
  if (existing) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'A delivery partner with this mobile number already exists.',
    });
  }

  const agent = await prisma.deliveryAgent.create({
    data: {
      storeId,
      name: input.name,
      mobile: input.mobile,
      vehicleNumber: input.vehicleNumber ?? null,
    },
  });
  return { id: agent.id };
}

export async function updateAgent(
  agentId: string,
  input: {
    name?: string;
    mobile?: string;
    vehicleNumber?: string | null;
    isActive?: boolean;
    isAvailable?: boolean;
  },
): Promise<void> {
  await prisma.deliveryAgent.update({
    where: { id: agentId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.mobile !== undefined ? { mobile: input.mobile } : {}),
      ...(input.vehicleNumber !== undefined ? { vehicleNumber: input.vehicleNumber } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.isAvailable !== undefined ? { isAvailable: input.isAvailable } : {}),
    },
  });
}

/**
 * Soft-deletes an agent, refusing while they still hold live orders — those
 * parcels are physically with that person.
 */
export async function deleteAgent(agentId: string): Promise<void> {
  const active = await prisma.deliveryAssignment.count({
    where: {
      agentId,
      status: {
        in: [
          DeliveryAssignmentStatus.ASSIGNED,
          DeliveryAssignmentStatus.ACCEPTED,
          DeliveryAssignmentStatus.PICKED_UP,
        ],
      },
    },
  });

  if (active > 0) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: `This partner still has ${active} order(s) in hand. Reassign them first.`,
    });
  }

  await prisma.deliveryAgent.update({
    where: { id: agentId },
    data: { deletedAt: new Date(), isActive: false, isAvailable: false },
  });
}

/**
 * Assigns an order to a rider.
 *
 * Reassignment cancels the previous assignment rather than editing it, so the
 * history of who held a parcel and when stays intact — which is what a cash
 * dispute is settled with.
 */
export async function assignOrder(
  orderId: string,
  agentId: string,
  assignedByUserId: string,
): Promise<{ assignmentId: string }> {
  const [order, agent] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId } }),
    prisma.deliveryAgent.findFirst({ where: { id: agentId, deletedAt: null } }),
  ]);

  if (!order) throw new AppError(ErrorCode.NOT_FOUND, { message: 'Order not found.' });
  if (!agent) throw new AppError(ErrorCode.NOT_FOUND, { message: 'Delivery partner not found.' });
  if (!agent.isActive) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'This delivery partner is inactive.',
    });
  }
  if (!ACTIVE_ORDER_STATUSES.includes(order.status)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, {
      message: 'This order is no longer active.',
    });
  }

  const assignmentId = await runInTransaction(async (tx) => {
    await tx.deliveryAssignment.updateMany({
      where: { orderId, status: { not: DeliveryAssignmentStatus.CANCELLED } },
      data: { status: DeliveryAssignmentStatus.CANCELLED, cancelledAt: new Date() },
    });

    const assignment = await tx.deliveryAssignment.create({
      data: {
        orderId,
        agentId,
        assignedByUserId,
        status: DeliveryAssignmentStatus.ASSIGNED,
      },
    });
    return assignment.id;
  });

  return { assignmentId };
}

/** Records cash actually handed over on a COD delivery (PRD §2.2 M2). */
export async function recordDelivery(
  orderId: string,
  input: { cashCollectedPaise?: number | null; notes?: string | null },
): Promise<void> {
  await prisma.deliveryAssignment.updateMany({
    where: { orderId, status: { not: DeliveryAssignmentStatus.CANCELLED } },
    data: {
      status: DeliveryAssignmentStatus.DELIVERED,
      deliveredAt: new Date(),
      cashCollectedPaise: input.cashCollectedPaise ?? null,
      notes: input.notes ?? null,
    },
  });
}

/** Day-end "cash to collect" report, per rider. */
export async function cashSummary(
  storeId: string,
  from: Date,
  to: Date,
): Promise<{ agentId: string; agentName: string; orderCount: number; cashPaise: number }[]> {
  const rows = await prisma.$queryRaw<
    { agent_id: string; agent_name: string; order_count: bigint; cash_paise: bigint | null }[]
  >`
    SELECT a.id AS agent_id, a.name AS agent_name,
           COUNT(da.id) AS order_count,
           SUM(COALESCE(da.cash_collected_paise, 0)) AS cash_paise
    FROM delivery_assignments da
    JOIN delivery_agents a ON a.id = da.agent_id
    WHERE a.store_id = ${storeId}::uuid
      AND da.status = 'DELIVERED'
      AND da.delivered_at BETWEEN ${from} AND ${to}
    GROUP BY a.id, a.name
    ORDER BY a.name`;

  return rows.map((row) => ({
    agentId: row.agent_id,
    agentName: row.agent_name,
    orderCount: Number(row.order_count),
    cashPaise: Number(row.cash_paise ?? 0),
  }));
}
