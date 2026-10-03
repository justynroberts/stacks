# Stacks is a desktop app: it needs your USB ports and SD slot, so it cannot run inside a container.
# This image is for everything around it: typecheck, tests, and a browser preview of the UI (demo data).
#
#   docker build -t stacks-web .
#   docker run --rm -p 5918:80 stacks-web      then open http://localhost:5918
FROM node:22-slim AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 CI=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run typecheck && npm test && npm run build:web

FROM nginx:1.27-alpine
COPY --from=build /app/out/web /usr/share/nginx/html
EXPOSE 80
