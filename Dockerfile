FROM node:22

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# The generated client is git-ignored and docker-ignored, so the image builds its own.
RUN npx prisma generate

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3008

ENTRYPOINT ["docker-entrypoint.sh"]
# Development mode, as the user runs it in the container (the package script already sets -p 3008).
CMD ["npm", "run", "dev"]
