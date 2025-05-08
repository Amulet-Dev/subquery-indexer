import { CosmosEvent } from "@subql/types-cosmos";
import { PoolPosition } from "../types";
import { config } from "../config";

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
