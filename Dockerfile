FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install LibreOffice + font tools + required runtime libs
RUN apt-get update && \
    apt-get install -y \
    libreoffice \
    libreoffice-writer \
    fontconfig \
    fonts-liberation \
    libgl1 \
    libglib2.0-0 \
    libnss3 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2t64 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    && fc-cache -f -v \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

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
