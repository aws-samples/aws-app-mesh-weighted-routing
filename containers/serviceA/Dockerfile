FROM node:16

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

COPY app.js ./

ENTRYPOINT ["node", "app.js"]
