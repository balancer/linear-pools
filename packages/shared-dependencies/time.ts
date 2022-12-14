import { BigNumber } from 'ethers';
import { time } from '@nomicfoundation/hardhat-network-helpers';

import { BigNumberish, bn } from './numbers';

export const SECOND = 1;
export const MINUTE = SECOND * 60;
export const HOUR = MINUTE * 60;
export const DAY = HOUR * 24;
export const WEEK = DAY * 7;
export const MONTH = DAY * 30;

export const advanceTime = async (seconds: BigNumberish): Promise<void> => {
  await time.increase(seconds);
};

export const currentTimestamp = async (): Promise<BigNumber> => {
  return bn(await time.latest());
};
