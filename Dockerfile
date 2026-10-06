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

# The reader (D27). Apache-2.0 engine and models, no GPU, no Python, no second
# process, and nothing resident: it is a program that starts, reads and exits.
# `osd` is the orientation detector — what notices a page is upside down.
RUN apk add --no-cache \
      tesseract-ocr \
      tesseract-ocr-data-eng \
      tesseract-ocr-data-osd

# The passport model, vendored rather than fetched: its source repository was
# archived in 2021, and a build that depends on an archived repository staying
# up is a build that fails one day (D27). Absent, the MRZ path says so and
# refuses rather than guessing with the English model.
COPY tessdata/ /usr/share/safehouse-tessdata/

# The document store, created in the image so the named volume mounted over it
# inherits this ownership on first use. A vault that writes its documents as
# root is one container escape away from being a worse problem than it needs to
# be, and the application writes nowhere else.
RUN mkdir -p /var/lib/safehouse/documents && chown -R node:node /var/lib/safehouse
USER node

EXPOSE 3000
CMD ["npm", "run", "start"]
