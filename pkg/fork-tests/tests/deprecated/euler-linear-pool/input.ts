import Task, { TaskMode } from '../../../src/task';
import { MONTH } from '@orbcollective/shared-dependencies/time';

export type EulerLinearPoolDeployment = {
  Vault: string;
  ProtocolFeePercentagesProvider: string;
  BalancerQueries: string;
  WETH: string;
  FactoryVersion: string;
  PoolVersion: string;
  InitialPauseWindowDuration: number;
  BufferPeriodDuration: number;
  EulerProtocol: string;
};

const Vault = new Task('20210418-vault', TaskMode.READ_ONLY);
const ProtocolFeePercentagesProvider = new Task('20220725-protocol-fee-percentages-provider', TaskMode.READ_ONLY);
const BalancerQueries = new Task('20220721-balancer-queries', TaskMode.READ_ONLY);
const WETH = new Task('00000000-tokens', TaskMode.READ_ONLY);

const BaseVersion = { version: 1, deployment: 'euler-linear-pool' };

export default {
  mainnet: {
    Vault,
    ProtocolFeePercentagesProvider,
    BalancerQueries,
    WETH,
    FactoryVersion: JSON.stringify({ name: 'EulerLinearPoolFactory', ...BaseVersion }),
    PoolVersion: JSON.stringify({ name: 'EulerLinearPool', ...BaseVersion }),
    InitialPauseWindowDuration: MONTH * 3,
    BufferPeriodDuration: MONTH,
    EulerProtocol: '0x27182842E098f60e3D576794A5bFFb0777E025d3',
  },
  goerli: {
    Vault,
    ProtocolFeePercentagesProvider,
    BalancerQueries,
    WETH,
    FactoryVersion: JSON.stringify({ name: 'EulerLinearPoolFactory', ...BaseVersion }),
    PoolVersion: JSON.stringify({ name: 'EulerLinearPool', ...BaseVersion }),
    InitialPauseWindowDuration: MONTH * 3,
    BufferPeriodDuration: MONTH,
    EulerProtocol: '0x931172BB95549d0f29e10ae2D079ABA3C63318B3',
  },
};
