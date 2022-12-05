import Task from '../../src/task';
import { TaskRunOptions } from '../../src/types';
import { GearboxLinearPoolDeployment } from './input';

export default async (task: Task, { force, from }: TaskRunOptions = {}): Promise<void> => {
  const input = task.input() as GearboxLinearPoolDeployment;
  const args = [input.Vault, input.ProtocolFeePercentagesProvider, input.BalancerQueries];

  await task.deployAndVerify('GearboxLinearPoolFactory', args, from, force);
};
