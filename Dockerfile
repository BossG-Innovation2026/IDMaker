FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV HOME=/tmp

# Install LibreOffice with ALL runtime dependencies for headless PDF conversion
# node:20-slim (Debian bookworm-slim) is missing many shared libraries
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libreoffice-core \
    libreoffice-writer \
    libreoffice-common \
    libreoffice-l10n-en-us \
    libreoffice-help-en-us \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    libglib2.0-0 \
    libxml2 \
    libnss3 \
    libnspr4 \
    libx11-6 \
    libxext6 \
    libxrender1 \
    libxt6 \
    libxrandr2 \
    libxinerama1 \
    libxfixes3 \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz0b \
    libgraphite2-3 \
    libgdk-pixbuf-2.0-0 \
    libgomp1 \
    liblcms2-2 \
    libdatrie1 \
    libthai0 \
    libepoxy0 \
    libdrm2 \
    libgbm1 \
    libatomic1 \
    dbus \
    && fc-cache -f -v \
    && rm -rf /var/lib/apt/lists/*

# Copy Windows fonts (Copperplate Gothic Bold, Consolas, Calibri)
COPY fonts/ /usr/share/fonts/truetype/custom/

# Rebuild font cache so LibreOffice picks them up
RUN fc-cache -f -v

# Create a non-root user for LibreOffice (some features fail as root)
RUN groupadd -r louser && useradd -r -g louser -d /tmp -s /bin/bash louser

WORKDIR /opt/render/project/src

COPY package*.json ./
RUN npm install --production

COPY . .

# Ensure uploads directory exists and is writable
RUN mkdir -p uploads && chmod 777 uploads

EXPOSE 10000

CMD ["node", "server.js"]
