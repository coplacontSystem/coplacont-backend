# Etapa 1: build
FROM node:18-alpine AS builder

# Establece el directorio de trabajo
WORKDIR /app

# Copia los archivos necesarios
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Etapa 2: runtime
FROM node:18-alpine

WORKDIR /app

# Solo copiamos lo necesario para producción
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
RUN npm install --only=production

# Expone el puerto
EXPOSE 3000

# Comando por defecto
CMD ["node", "dist/main.js"]