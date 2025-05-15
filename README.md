# subquery-indexer

## Overview

The `subquery-indexer` is a blockchain indexer built with [SubQuery Network](https://subquery.network). It powers Amulet Finance’s ingot program by tracking Osmosis concentrated liquidity positions and exposing them over a GraphQL API consumed by the [`points-crawler`](https://github.com/Amulet-Dev/points-crawler).

In its current state, this codebase is configured only to support Osmosis. It tracks several `concentratedliquidity` message to track user pool positions. Those messages can be found in [project-osmosis.yaml](project-osmosis.yaml).

```yaml
messages:
  - MsgWithdrawPosition
  - MsgCreatePosition
  - MsgAddToPosition
  - MsgFungifyChargedPositions
```

## Core components

| Path                              | Description                                                                                     |
| :-------------------------------- | :---------------------------------------------------------------------------------------------- |
| `project-osmosis.yaml`            | Handles the configuration of an osmosis node                                                    |
| `docker-compose.yml`              | Configures the build of the indexer in 3 parts: postgres, an osmosis node, and a graphql-engine |
| `schema.graphql`                  | Houses graphql interfaces used to generate types and postgres tables                            |
| `src/config.ts`                   | Defines what denoms and LPs to track                                                            |
| `src/mappings/mappingHandlers.ts` | Houses the code that is run when a `concentratedliquidity` message is fired                     |

## Development

Clone the repo and install dependencies

```sh
gh repo clone Amulet-Dev/subquery-indexer
cd subquery-indexer
yarn install
```

Generate types from `schema.graphql`

```sh
yarn codegen
```

Build the project using the subquery sdk

```sh
yarn build
```

Start the docker compose cluster

```sh
yarn start:docker # to run in attached mode
yarn start:prod # to run in detached mode
```

> Note: A good tool for viewing docker compose containers and other resources is [lazydocker](https://github.com/jesseduffield/lazydocker) if you don't have it already.

## Production

The `subquery-indexer` is deployed on the `ingots-crawler` VM in the `amulet-v1` GCP project and runs as a Docker Compose cluster. It continuously indexes Osmosis liquidity pool activity for downstream consumption by `points-crawler`.

The `subquery-indexer` runs on docker in 3 containers: `postgres`, `node-osmosis`, `graphql-engine`. It is accessible to the running `points-crawler` instance over a graphql interface at `0.0.0.0:3001`. It runs continuously to record `concentratedliquidity` positions so that the `osmosis-lp` source on `points-crawler` can capture reliable data with a query like:

```ts
// From https://github.com/Amulet-Dev/points-crawler/blob/main/lib/sources/osmosis-lp/index.ts
const GET_ACTIVE_POSITIONS = gql`
  query GetAllPoolPositionsAtHeight(
    $limit: Int!
    $offset: Int!
    $height: BigFloat!
  ) {
    poolPositions(
      first: $limit
      offset: $offset
      filter: {
        height: { lessThanOrEqualTo: $height }
        or: [
          { closedHeight: { greaterThan: $height } }
          { closedHeight: { isNull: true } }
        ]
      }
    ) {
      nodes {
        id
        height
      }
    }
  }
`;
```

`subquery-indexer`'s only purpose in production as of 5/15/25 is to record Osmosis `concentratedliquidity` data into a postgres database and make that data accessible to the `points-crawler`.

### Production Warnings

In the past `subquery-indexer` has recorded data unbounded and therefore would cause the `ingots-crawler` VM to reach disk capacity. Reaching disk capacity is a **catastrophic** problem for Amulet's ingot program as not only will the indexer no longer be able to record Osmosis data, but the crawler will not be able to write new user points to disk.

To combat the unbounded storage issues posed by recording blockchain data in real time, several scripts have been enabled on the `ingots-crawler` VM. They are controlled by `systemctl`.

#### prune_postgres.sh

[prune_postgres.sh](/scripts/prune_postgres.sh) works to remove old data from the indexer's postgres database. It deletes data older than `RETENTION_DAYS` (currently any data older than 5 days old) and reclaims the table space using a postgres plugin called `pg_repack`.

`prune_postgres.sh` is set to run once a day by `systemctl`.

To examine how the pruning is working, you can view the log file on `ingots-crawler` at `~/purge-pool-positions.log`

#### reclaim_docker_space.sh

[reclaim_docker_space.sh](/scripts/reclaim_docker_space.sh) works to ensure old and unused docker artifacts are continuously removed from the virtual machine.

`reclaim_docker_space.sh` is set to run once a week by `systemctl`.

To examine how the script is working, you can view the log file on `ingots-crawler` at `~/reclaim-docker-space.log`

## Future Considerations

As a maintainer of this repository, you will not often need to do anything to the codebase unless you are either adding a new `source` on the [points-crawler]() that requires a new blockchain to be indexed to source data or you are tracking additional pools on Osmosis.

If you are updating the pools and denoms to be tracked on Osmosis then you simply need to:

1. Stop the indexer with `yarn stop:prod`
2. Update `config.ts` with a new `denoms` or `pools`

```ts
// config.ts
export const config = {
  "osmosis-1": {
    denoms: ["uosmo"],
    poolIds: ["1464", "1135"],
  },
};
```

3. Rebuild the project code with `yarn build`
4. Restart docker deployment with `yarn start:prod`

The osmosis node will begin indexing from the last height before you stopped the docker compose cluster.

If you want to extend this indexer to support a new blockchain beyond Osmosis, use `project-osmosis.yaml` as a reference and consult the [SubQuery documentation](https://academy.subquery.network/indexer/welcome.html) for official guidance.

Once you've configured your new node yaml file, you can:

- Add the new yaml file to `docker-compose.yml` to ensure the new node builds
- Add any new graphql schemas to `schema.graphql`
- Add a new config key for your blockchain with relevant `denoms` and `assets` to `config.ts`
- Add new message handlers to `mappingHandlers.ts`
