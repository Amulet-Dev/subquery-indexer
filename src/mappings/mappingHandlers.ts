import {
    CosmosEvent,
    CosmosMessage,
    CosmosTransaction,
} from "@subql/types-cosmos";
import {
    FungifyChargedPositions,
    FungifyChargedPositionsResponse,
    PoolPosition,
    UserBalance,
    UserBond,
} from "../types";
import { config } from "../config";

type BondExecuteMessageType = {
    bond: {
        ref?: string;
    };
};

const amountToSumAndDenom = (amount: string) => {
    const [, sum, denom] = amount.split(/^(\d+)(.+)$/);
    return { sum, denom };
};

export async function handleCoin(tx: CosmosTransaction): Promise<void> {
    const networkConfig = config[tx.block.header.chainId as keyof typeof config];
    for (const event of tx.tx.events) {
        if (event.type === "coinbase") {
            const amount = event.attributes.find((a) => a.key === "amount")?.value;
            const recipient = event.attributes.find((a) => a.key === "minter")?.value;
            if (!amount || !recipient) continue;
            const { sum: sumStr, denom } = amountToSumAndDenom(amount);
            if (!networkConfig.denoms.includes(denom)) continue;
            const sum = BigInt(sumStr);
            const current = (await UserBalance.get(recipient))?.balance || BigInt(0);
            await UserBalance.create({
                lastHeight: BigInt(tx.block.header.height),
                balance: current + sum,
                id: recipient,
                chainId: tx.block.header.chainId,
                denom,
                lastDate: new Date(tx.block.header.time.toDateString()),
            }).save();
        }
        if (event.type === "transfer") {
            const amount = event.attributes.find((a) => a.key === "amount")?.value;
            const recipient = event.attributes.find(
                (a) => a.key === "recipient"
            )?.value;
            const sender = event.attributes.find((a) => a.key === "sender")?.value;
            if (!amount || !recipient || !sender) continue;
            const { sum: sumStr, denom } = amountToSumAndDenom(amount);
            if (!networkConfig.denoms.includes(denom)) continue;
            const sum = BigInt(sumStr);
            {
                const current =
                    (await UserBalance.get(recipient))?.balance || BigInt(0);
                await UserBalance.create({
                    lastHeight: BigInt(tx.block.header.height),
                    balance: current + sum,
                    chainId: tx.block.header.chainId,
                    id: recipient,
                    denom,
                    lastDate: new Date(tx.block.header.time.toDateString()),
                }).save();
            }
            {
                const current = (await UserBalance.get(sender))?.balance || BigInt(0);
                await UserBalance.create({
                    lastHeight: BigInt(tx.block.header.height),
                    balance: current - sum,
                    denom,
                    id: sender,
                    chainId: tx.block.header.chainId,
                    lastDate: new Date(tx.block.header.time.toDateString()),
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
        logger.info("User cannot refer himself");
        return;
    }
    const prevUserBond = await UserBond.get(msg.msg.decodedMsg.sender);
    if (prevUserBond) {
        logger.info("User %s already bonded");
        return;
    }
    await UserBond.create({
        id: msg.msg.decodedMsg.sender,
        ref: referral,
        height: BigInt(msg.block.header.height),
        ts: BigInt(msg.block.header.time.getTime()),
    }).save();
}

export async function handleCreatePosition(input: CosmosEvent): Promise<void> {
    const poolIds = config["osmosis-1"].poolIds;

    const { event } = input;
    const attributes: Record<string, string> = event.attributes.reduce(
        (acc, { key, value }) => ({ ...acc, [key]: value }),
        {}
    );
    const poolId = attributes.pool_id || "";
    const positionId = attributes.position_id || "";
    if (
        attributes.module !== "concentratedliquidity" ||
        !poolId ||
        !positionId ||
        !poolIds.includes(poolId)
    ) {
        return;
    }
    const id = poolId + "_" + positionId;
    await PoolPosition.create({
        id,
        poolId,
        height: BigInt(input.block.header.height),
        createdAt: new Date(input.block.header.time.getTime()),
    }).save();
    logger.info("HANDLE_CREATE_POSITION: Position %s added", id);
}

export async function handleRemovePosition(input: CosmosEvent): Promise<void> {
    const poolIds = config["osmosis-1"].poolIds;

    const { event } = input;
    const attributes: Record<string, string> = event.attributes.reduce(
        (acc, { key, value }) => ({ ...acc, [key]: value }),
        {}
    );
    const poolId = attributes.pool_id || "";
    const positionId = attributes.position_id || "";
    if (
        attributes.module !== "concentratedliquidity" ||
        !poolId ||
        !positionId ||
        !poolIds.includes(poolId)
    ) {
        return;
    }
    const id = poolId + "_" + positionId;
    const position = await PoolPosition.get(id);
    if (position) {
        position.closedAt = new Date(input.block.header.time.getTime());
        position.closedHeight = BigInt(input.block.header.height);
        await position.save();
        logger.info(
            "HANDLE_REMOVE_POSITION: Position %s closed at height %s",
            id,
            position.closedHeight
        );
    } else {
        logger.warn(
            "HANDLE_REMOVE_POSITION: Position %s not found when trying to close it",
            id
        );
    }
}

export async function handleFungifyPositions(
    input: CosmosEvent
): Promise<void> {
    try {
        logger.info("HANDLE_FUNGIFY_POSITIONS: Fired...");
        // Extract attributes from the event
        const attributes = input.event.attributes.reduce(
            (acc: any, { key, value }: any) => {
                acc[key] = value;
                return acc;
            },
            {}
        );

        const positionIdsStr = attributes.position_ids; // Assuming 'position_ids' is the key
        const newPositionIdStr = attributes.new_position_id; // Assuming 'new_position_id' is the key

        if (!positionIdsStr || !newPositionIdStr) {
            logger.warn("Fungify event missing position_ids or new_position_id");
            return;
        }

        // Parse position IDs
        const positionIds: number[] = positionIdsStr.split(","); // Adjust based on how position IDs are serialized

        const newPositionId = newPositionIdStr;

        // Fetch and delete old positions
        for (const posId of positionIds) {
            const posIdStr = posId.toString();
            const oldPosition = await PoolPosition.get(posIdStr);
            if (oldPosition) {
                await PoolPosition.remove(posIdStr);
                logger.info(`Removed old position with ID: ${posId}`);
            } else {
                logger.warn(`Old position with ID: ${posId} not found`);
            }
        }

        // Fetch data from one of the old positions to populate the new position
        // Assuming all old positions have the same poolId and tick ranges
        const sampleOldPosition = await PoolPosition.get(positionIds[0].toString());
        if (!sampleOldPosition) {
            logger.warn(`Sample old position with ID: ${positionIds[0]} not found`);
            return;
        }

        // Create the new position
        await PoolPosition.create({
            id: sampleOldPosition.poolId + "_" + newPositionId,
            poolId: sampleOldPosition.poolId,
            height: BigInt(input.block.header.height),
            createdAt: new Date(input.block.header.time.getTime()),
        }).save();

        logger.info(`Created new fungified position with ID: ${newPositionId}`);
    } catch (error) {
        logger.error(`Error handling fungify positions: ${error}`);
    }
}
