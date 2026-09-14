FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# Use a Debian-based image with LibreOffice pre-installed
FROM ubuntu:22.04

# Install LibreOffice and dependencies
RUN apt-get update && \
    apt-get install -y \
    libreoffice \
    libreoffice-writer \
    fonts-liberation \
    fontconfig \
    && fc-cache -f -v && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get update && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Verify Node.js and npm are installed
RUN node --version && npm --version

# Copy Windows fonts (Copperplate Gothic Bold, Consolas, Calibri)
COPY fonts/ /usr/share/fonts/truetype/custom/

# Rebuild font cache so LibreOffice picks them up
RUN fc-cache -f -v

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
