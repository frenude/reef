FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist/ dist/
ENV PORT=9876
ENV RELAY_TOKEN=""
EXPOSE 9876
CMD ["node", "dist/relay-server.js"]
