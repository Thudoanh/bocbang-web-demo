FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Only public browser configuration is passed to this build stage.
ARG VITE_API_BASE_URL=http://localhost:8000/api/v1
ARG VITE_WS_BASE_URL=ws://localhost:8000/api/v1
ARG VITE_MAX_UPLOAD_BYTES=524288000
ARG VITE_MAX_MEDIA_DURATION_SECONDS=7200
RUN npm run build

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
