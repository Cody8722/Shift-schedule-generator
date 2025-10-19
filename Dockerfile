# 1. 選擇一個官方的 Node.js 執行環境作為基礎
FROM node:18-alpine

# 2. 在容器中建立一個工作目錄
WORKDIR /usr/src/app

# 3. 複製 package.json 和 package-lock.json (如果有的話)
COPY package*.json ./

# 4. 安裝專案依賴
RUN npm install

# 5. 複製所有專案檔案到工作目錄（包含 holidays 資料夾）
COPY . .

# 6. 告訴 Docker 容器在執行時會監聽 3000 這個 port
EXPOSE 3000

# 7. 定義容器啟動時要執行的指令
CMD [ "npm", "start" ]
