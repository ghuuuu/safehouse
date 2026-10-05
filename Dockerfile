FROM node:24-alpine AS development-dependencies-env
COPY . /app
WORKDIR /app
RUN npm ci

FROM node:24-alpine AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev

FROM node:24-alpine AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

FROM node:24-alpine
COPY ./package.json package-lock.json /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
WORKDIR /app

# The document store, created in the image so the named volume mounted over it
# inherits this ownership on first use. A vault that writes its documents as
# root is one container escape away from being a worse problem than it needs to
# be, and the application writes nowhere else.
RUN mkdir -p /var/lib/safehouse/documents && chown -R node:node /var/lib/safehouse
USER node

EXPOSE 3000
CMD ["npm", "run", "start"]
