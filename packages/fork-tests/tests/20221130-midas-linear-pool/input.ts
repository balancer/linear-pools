import Task, { TaskMode } from '../../src/task';
import { MONTH } from '@orbcollective/shared-dependencies/time';

export type MidasLinearPoolDeployment = {
  Vault: string;
  ProtocolFeePercentagesProvider: string;
  BalancerQueries: string;
  WETH: string;
  FactoryVersion: string;
  PoolVersion: string;
  InitialPauseWindowDuration: number;
  BufferPeriodDuration: number;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const BalancerQueries = new Task('20220721-balancer-queries', TaskMode.READ_ONLY);
const ProtocolFeePercentagesProvider = new Task('20220725-protocol-fee-percentages-provider', TaskMode.READ_ONLY);
const WETH = new Task('00000000-tokens', TaskMode.READ_ONLY);

const BaseVersion = { version: 1, deployment: '20221130-midas-linear-pool' };

export default {
  Vault,
  BalancerQueries,
  ProtocolFeePercentagesProvider,
  WETH,
  FactoryVersion: JSON.stringify({ name: 'MidasLinearPoolFactory', ...BaseVersion }),
  PoolVersion: JSON.stringify({ name: 'MidasLinearPool', ...BaseVersion }),
  InitialPauseWindowDuration: MONTH * 3,
  BufferPeriodDuration: MONTH,
};