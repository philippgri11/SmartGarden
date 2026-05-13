FROM node:20-alpine AS build

WORKDIR /app
ENV npm_config_audit=false \
    npm_config_fund=false \
    npm_config_progress=false
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund --progress=false
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/irrigation-control-frontend/browser /usr/share/nginx/html
EXPOSE 80
