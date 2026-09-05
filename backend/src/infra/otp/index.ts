import { env } from '../../config/env';
import { moduleLogger } from '../../common/logger';
import { ConsoleOtpProvider } from './console.provider';
import { Msg91OtpProvider } from './msg91.provider';
import type { OtpProvider } from './types';

const log = moduleLogger('otp');

function createOtpProvider(): OtpProvider {
  const provider =
    env.OTP_PROVIDER === 'msg91' ? new Msg91OtpProvider() : new ConsoleOtpProvider();
  log.info({ provider: provider.name }, 'otp provider initialised');
  return provider;
}

export const otpProvider: OtpProvider = createOtpProvider();
export type { OtpProvider, SendOtpInput, SendOtpResult } from './types';
