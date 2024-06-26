import { CosmosEvent, CosmosMessage, CosmosTransaction } from "@subql/types-cosmos";
import { PoolPosition, UserBalance, UserBond } from "../types";
import { config } from "../config";

type BondExecuteMessageType = {
    bond: {
      ref?: string
    };
};

const amountToSumAndDenom = (amount:string) => {
  const [,sum,denom,] = amount.split(/^(\d+)(.+)$/);
  return {sum, denom};
}

export async function handleCoinSecret(
  tx: CosmosTransaction
): Promise<void> {
  const networkConfig = config[tx.block.header.chainId as (keyof typeof config)];
  for(const event of tx.tx.events) {
    if (event.type === 'coinbase') {
      const amount = event.attributes.find(a => a.key === 'YW1vdW50')?.value;
      const recipientB64 =  event.attributes.find(a => a.key === 'bWludGVy')?.value;
      if (!amount || !recipientB64) continue;
      const recipient = Buffer.from(recipientB64, 'base64').toString();
      const {sum:sumStr, denom} = amountToSumAndDenom(Buffer.from(amount,'base64').toString());
      if (!networkConfig.denoms.includes(denom)) continue;
      const sum = BigInt(sumStr);
      const current = (await UserBalance.get(recipient))?.balance || BigInt(0);
      await UserBalance.create({
        lastHeight: BigInt(tx.block.header.height),
        balance: current + sum,
        id: recipient,
        chainId: tx.block.header.chainId,
        denom,
        lastDate: new Date(tx.block.header.time.toDateString())
      }).save();
    }
    if (event.type === 'transfer' ) {
      const amount = event.attributes.find(a => a.key === 'YW1vdW50')?.value;
      const recipientB64 = event.attributes.find(a => a.key === 'cmVjaXBpZW50')?.value;
      const senderB64 = event.attributes.find(a => a.key === 'c2VuZGVy')?.value;
      if (!amount || !recipientB64 || !senderB64) continue;
      const recipient = Buffer.from(recipientB64, 'base64').toString();
      const sender = Buffer.from(senderB64, 'base64').toString();
      const {sum:sumStr, denom} = amountToSumAndDenom(Buffer.from(amount, 'base64').toString());
      if (!networkConfig.denoms.includes(denom)) continue;
      const sum = BigInt(sumStr);
      {
        const current = (await UserBalance.get(recipient))?.balance || BigInt(0);
        await UserBalance.create({
          lastHeight: BigInt(tx.block.header.height),
          balance: current + sum,
          chainId: tx.block.header.chainId,
          id: recipient,
          denom,
          lastDate: new Date(tx.block.header.time.toDateString())
        }).save();
      }
      {
        const current = (await UserBalance.get(recipient))?.balance || BigInt(0);
        await UserBalance.create({
          lastHeight: BigInt(tx.block.header.height),
          balance: current - sum,
          denom,
          id: sender,
          chainId: tx.block.header.chainId,
          lastDate: new Date(tx.block.header.time.toDateString())
        }).save();
      }
    }    
  }
}


export async function handleCoin(
  tx: CosmosTransaction
): Promise<void> {
  const networkConfig = config[tx.block.header.chainId as (keyof typeof config)];
  for(const event of tx.tx.events) {
    if (event.type === 'coinbase') {
      const amount = event.attributes.find(a => a.key === 'amount')?.value;
      const recipient =  event.attributes.find(a => a.key === 'minter')?.value;
      if (!amount || !recipient) continue;
      const {sum:sumStr, denom} = amountToSumAndDenom(amount);
      if (!networkConfig.denoms.includes(denom)) continue;
      const sum = BigInt(sumStr);
      const current = (await UserBalance.get(recipient))?.balance || BigInt(0);
      await UserBalance.create({
        lastHeight: BigInt(tx.block.header.height),
        balance: current + sum,
        id: recipient,
        chainId: tx.block.header.chainId,
        denom,
        lastDate: new Date(tx.block.header.time.toDateString())
      }).save();
    }
    if (event.type === 'transfer' ) {
      const amount = event.attributes.find(a => a.key === 'amount')?.value;
      const recipient = event.attributes.find(a => a.key === 'recipient')?.value;
      const sender = event.attributes.find(a => a.key === 'sender')?.value;
      if (!amount || !recipient || !sender) continue;
      const {sum:sumStr, denom} = amountToSumAndDenom(amount);
      if (!networkConfig.denoms.includes(denom)) continue;
      const sum = BigInt(sumStr);
      {
        const current = (await UserBalance.get(recipient))?.balance || BigInt(0);
        await UserBalance.create({
          lastHeight: BigInt(tx.block.header.height),
          balance: current + sum,
          chainId: tx.block.header.chainId,
          id: recipient,
          denom,
          lastDate: new Date(tx.block.header.time.toDateString())
        }).save();
      }
      {
        const current = (await UserBalance.get(recipient))?.balance || BigInt(0);
        await UserBalance.create({
          lastHeight: BigInt(tx.block.header.height),
          balance: current - sum,
          denom,
          id: sender,
          chainId: tx.block.header.chainId,
          lastDate: new Date(tx.block.header.time.toDateString())
        }).save();
      }
    }    
  }
}


type ExecuteBondMessageType = {
  type: string;
  sender: string;
  contract: string;
  msg: {
    bond?: {
      ref: string;
    };
  };
};

export async function handleBondExecution(
  msg: CosmosMessage<ExecuteBondMessageType>
): Promise<void> {
  logger.info(
    `New Bond Execution at block ${msg.block.header.height.toString()}`
  );
  const referral = msg.msg.decodedMsg.msg.bond?.ref || "";
  if (referral === msg.msg.decodedMsg.sender) {
    logger.info('User cannot refer himself');
    return;
  }
  const prevUserBond = await UserBond.get(msg.msg.decodedMsg.sender);
  if (prevUserBond) {
    logger.info('User %s already bonded');
    return;
  }
  await (UserBond.create({
    id: msg.msg.decodedMsg.sender,
    ref: referral,
    height: BigInt(msg.block.header.height),
    ts: BigInt(msg.block.header.time.getTime())
  })).save();
}

export async function handleCreatePosition(
  input: CosmosEvent,
): Promise<void> {
  const { event } = input;
  const attributes: Record<string, string> = event.attributes.reduce((acc, { key, value }) => ({...acc, [key]: value}), {});
  const poolId = attributes.pool_id || '';
  const positionId = attributes.position_id || '';
  if (attributes.module !== 'concentratedliquidity' || !poolId || !positionId || poolId !== config["osmosis-1"].poolId) {
    return;
  }
  const id = poolId + '_' + positionId;
  await PoolPosition.create({
    id,
    height: BigInt(input.block.header.height),
    created: new Date(input.block.header.time.getTime()),
  }).save();
  logger.info('Position %s added', id);
}
export async function handleRemovePosition(
  input: CosmosEvent
): Promise<void> {
  const { event } = input;
  const attributes: Record<string, string> = event.attributes.reduce((acc, { key, value }) => ({...acc, [key]: value}), {});
  const poolId = attributes.pool_id || '';
  const positionId = attributes.position_id || '';
  if (attributes.module !== 'concentratedliquidity' || !poolId || !positionId || poolId !== config["osmosis-1"].poolId) {
    return;
  }
  const id = poolId + '_' + positionId;
  await PoolPosition.remove(id);
  logger.info('Position %s removed', id);
}