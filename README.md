班表產生器 (伺服器版) - 使用說明
這是一個擁有前端介面與後端伺服器的網路應用程式。所有設定都會被集中儲存在伺服器端的 database.json 檔案中。

專案結構
請確保以下檔案都在同一個資料夾底下：

index.html (前端使用者介面)

server.js (後端伺服器邏輯)

package.json (專案依賴設定)

database.json (儲存設定的資料庫檔案)

README.md (本說明檔)

如何執行
步驟 1: 安裝 Node.js
如果您尚未安裝 Node.js，請先至 Node.js 官方網站 下載並安裝。建議安裝 LTS (長期支援) 版本。

您可以打開您的終端機 (Terminal) 或命令提示字元 (Command Prompt) 輸入以下指令來檢查是否安裝成功：

node -v

如果出現版本號 (例如 v18.17.1)，代表安裝成功。

步驟 2: 安裝專案依賴
打開您的終端機。

使用 cd 指令，將路徑切換到您存放本專案所有檔案的資料夾。例如：

cd D:\Users\YourName\Desktop\schedule-project

在終端機中輸入以下指令並按下 Enter：

npm install

這個指令會讀取 package.json 檔案，並自動下載本專案需要的 express 和 cors 套件。您會看到資料夾中多出一個 node_modules 資料夾和 package-lock.json 檔案，這是正常現象。

步驟 3: 啟動伺服器
安裝完依賴後，繼續在同一個終端機視窗中輸入以下指令：

npm start

如果成功，您會看到終端機顯示 伺服器正在 http://localhost:3000 上運行。

請注意： 這個終端機視窗必須保持開啟，您的伺服器才會持續運作。如果關閉視窗，伺服器就會停止。

步驟 4: 開啟並使用班表產生器
打開您的任何一個網頁瀏覽器 (例如 Chrome, Edge, Firefox)。

在網址列輸入 http://localhost:3000 並按下 Enter。

您現在就可以看到並使用您的班表產生器了！

如何運作
讀取設定：當您打開網頁時，index.html 會自動向後端 (server.js) 發送請求，讀取 database.json 的內容並填入介面中。

儲存設定：當您點擊「產生並儲存設定」按鈕時，index.html 會將介面上所有的設定打包，傳送給後端，後端會將這些新設定覆蓋寫入 database.json 檔案中。
