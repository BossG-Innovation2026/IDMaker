FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install LibreOffice + font tools
RUN apt-get update && \
    apt-get install -y \
    libreoffice \
    libreoffice-writer \
    fontconfig \
    fonts-liberation && \
    fc-cache -f -v && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy Windows fonts (Copperplate Gothic Bold, Consolas, Calibri)
COPY fonts/ /usr/share/fonts/truetype/custom/

# Rebuild font cache so LibreOffice picks them up
RUN fc-cache -f -v

WORKDIR /opt/render/project/src

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 10000

CMD ["node", "server.js"]
