import Task, { TaskMode } from '../../src/task';

export type GearboxLinearPoolDeployment = {
  Vault: string;
  ProtocolFeePercentagesProvider: string;
  BalancerQueries: string;
  FactoryVersion: string;
  PoolVersion: string;
  InitialPauseWindowDuration: number;
  BufferPeriodDuration: number;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const ProtocolFeePercentagesProvider = new Task('20220725-protocol-fee-percentages-provider', TaskMode.READ_ONLY);
const BalancerQueries = new Task('20220721-balancer-queries', TaskMode.READ_ONLY);

export default {
  Vault,
  ProtocolFeePercentagesProvider,
  BalancerQueries,
};
