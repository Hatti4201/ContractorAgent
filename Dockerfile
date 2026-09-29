FROM node:22

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

EXPOSE 3008

CMD ["npm", "run", "dev", "--", "-p", "3008"]