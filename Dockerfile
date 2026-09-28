FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN yarn build \
  && yarn install --frozen-lockfile --production \
  && yarn cache clean

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1001 app \
  && useradd --uid 1001 --gid app --create-home app

ENV NODE_ENV=production
ENV PORT=3050

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

USER app
EXPOSE 3050

CMD ["node", "dist/main.js"]
