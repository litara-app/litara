-- Drives the UNMODIFIED KOReader sync client (plugins/kosync.koplugin/KOSyncClient.lua) and
-- KOReader's own util.partialMD5 / ffi.sha2 md5 under KOReader's bundled LuaJIT.
-- Usage (cwd = KOReader install dir): luajit kosync_driver.lua <base_url> <username> <password> <file> <device> <mode>
-- mode: "read-write" = authorize, get, put, get;  "put-only" = authorize, put (no prior get).
package.path = "?.lua;common/?.lua;rocks/share/lua/5.1/?.lua;frontend/?.lua;plugins/kosync.koplugin/?.lua;" .. package.path
package.cpath = "common/?.so;common/?.dll;/usr/lib/lib?.so;" .. package.cpath
require("setupkoenv")
-- Headless: KOSyncClient only touches UIManager.looper (nil => synchronous HTTP). Loading the real UIManager would
-- probe SDL display hardware, so only that module is replaced by an empty table. KOSyncClient.lua itself is unmodified.
package.loaded["ui/uimanager"] = {}
package.loaded["device"] = { model = "Litara-T006-headless" } -- socketutil reads only Device.model (user agent)
local util = require("util")
local md5 = require("ffi/sha2").md5
local JSON = require("json")
local base, user, password, file, device, mode = unpack(arg)
local Client = require("KOSyncClient")
local spec = io.open("plugins/kosync.koplugin/api.json"):read("*a")
local client = Client:new{ custom_url = base, service_spec = "plugins/kosync.koplugin/api.json" }
local userkey = md5(password)           -- exactly what the plugin does at login
local doc = util.partialMD5(file)       -- exactly what the plugin uses as the document id
local function emit(step, ok, a, b) print("RESULT " .. JSON.encode({ step = step, ok = ok, status = a, body = b })) end
print("DOC " .. tostring(doc))
local ok, body = client:authorize(user, userkey); emit("authorize", ok, nil, body)
local function get(label)
  client:get_progress(user, userkey, doc, function(o, b) emit(label, o, nil, b) end)
end
if mode == "read-write" then get("get_before") end
client:update_progress(user, userkey, doc, nil, "epubcfi(/6/2!/4/2)", 0.25, device, device .. "-id", function(o, status, b) emit("put", o, status, b) end)
if mode == "read-write" then get("get_after") end
