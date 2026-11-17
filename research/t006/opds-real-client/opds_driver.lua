-- Drives KOReader's UNMODIFIED OPDS client code (plugins/opds.koplugin/opdsbrowser.lua + opdsparser.lua), the same code
-- its catalog browser uses, under KOReader's bundled LuaJIT. Only the UI widgets that browser class inherits from are
-- replaced by inert stand-ins (nothing is drawn); parsing, link selection, search, facets, pagination and HTTP are real.
-- Usage (cwd = KOReader install dir): luajit opds_driver.lua <root_url> <username> <password> <search_term>
package.path = "?.lua;common/?.lua;rocks/share/lua/5.1/?.lua;frontend/?.lua;plugins/opds.koplugin/?.lua;" .. package.path
package.cpath = "common/?.so;common/?.dll;/usr/lib/lib?.so;" .. package.cpath
require("setupkoenv")
local function inert()
  return setmetatable({}, { __index = function(t) return t end, __call = function(t) return t end })
end
package.loaded["device"] = { model = "Litara-T006-headless", canUseWAL = function() return false end }
local Menu = { extend = function(self, o) o = o or {}; o.__index = o; return setmetatable(o, { __index = self }) end }
for _, m in ipairs({ "ui/bidi", "ui/widget/buttondialog", "ui/widget/checkbutton", "ui/widget/confirmbox", "ui/widget/infomessage",
  "ui/widget/inputdialog", "ui/widget/multiinputdialog", "ui/network/manager", "ui/widget/notification", "ui/widget/spinwidget",
  "ui/widget/textviewer", "ui/trapper", "ui/uimanager" }) do package.loaded[m] = inert() end
package.loaded["ui/widget/menu"] = Menu
-- The real registry answers per installed document engine. This stand-in answers for document MIME types only, never
-- for catalog feeds, so entries are classified the way the real client would classify them.
local docmime = { ["application/epub+zip"] = true, ["application/pdf"] = true, ["application/x-cbz"] = true, ["application/vnd.comicbook+zip"] = true,
  ["application/x-fictionbook+xml"] = true, ["application/x-mobipocket-ebook"] = true, ["application/fb2+zip"] = true, ["text/plain"] = true }
package.loaded["document/documentregistry"] = { hasProvider = function(_, _, mimetype) return docmime[mimetype] == true end }
package.loaded["cache"] = { new = function() return { check = function() end, insert = function() end } end }
package.loaded["gettext"] = setmetatable({ ngettext = function(a) return a end }, { __call = function(_, s) return s end })
local OPDSBrowser = require("opdsbrowser")
local JSON = require("json")
local http = require("socket.http")
local ltn12 = require("ltn12")
local sha2 = require("ffi/sha2")
local root, user, pass, term = unpack(arg)
local B = setmetatable({ root_catalog_username = user, root_catalog_password = pass }, { __index = OPDSBrowser })
local function download(href)
  local sink = {}
  local _, code = http.request({ url = href, user = user, password = pass, sink = ltn12.sink.table(sink), headers = { ["Accept-Encoding"] = "identity" } })
  local body = table.concat(sink)
  return code, #body, sha2.sha256(body)
end
local seen, queue, pages, books, nav = {}, { root }, 0, {}, {}
local searched, search_hits = false, 0
while #queue > 0 and pages < 40 do
  local u = table.remove(queue, 1)
  if not seen[u] then
    seen[u] = true; pages = pages + 1
    local items = B:genItemTableFromURL(u)
    if type(items) ~= "table" then items = {} end
    for _, it in ipairs(items) do
      if it.acquisitions and #it.acquisitions > 0 then
        local acq = {}
        for _, a in ipairs(it.acquisitions) do acq[#acq + 1] = { type = a.type, href = a.href } end
        books[#books + 1] = { title = it.title or it.text, author = it.author, acquisitions = acq, page = u }
      elseif it.url then
        nav[#nav + 1] = it.url; queue[#queue + 1] = it.url
      end
    end
    -- Pagination exactly as the browser pages through a catalog.
    local nextu = (items.hrefs and items.hrefs.next) or nil
    if nextu then queue[#queue + 1] = nextu end
    if B.search_url and not searched and term and term ~= "" then
      searched = true
      local su = B.search_url:format(term)
      local sitems = B:genItemTableFromURL(su)
      for _, it in ipairs(sitems or {}) do if it.acquisitions and #it.acquisitions > 0 then search_hits = search_hits + 1 end end
      print("SEARCH " .. JSON.encode({ url = su, hits = search_hits }))
    end
  end
end
-- Download every distinct acquisition once, as the browser's download dialog would.
local done = {}
for _, b in ipairs(books) do
  for _, a in ipairs(b.acquisitions) do
    if not done[a.href] then
      done[a.href] = true
      local code, n, h = download(a.href)
      print("DOWNLOAD " .. JSON.encode({ title = b.title, href = a.href, type = a.type, status = code, bytes = n, sha256 = h }))
    end
  end
end
print("SUMMARY " .. JSON.encode({ pages = pages, books = #books, navigation = #nav, searched = searched, searchHits = search_hits }))
