local cjson = require "cjson.safe"

local M = {}
local machines = {}
local public_machines = {}

local forbidden_headers = {
    ["connection"] = true,
    ["content-length"] = true,
    ["keep-alive"] = true,
    ["proxy-authenticate"] = true,
    ["proxy-authorization"] = true,
    ["te"] = true,
    ["trailer"] = true,
    ["transfer-encoding"] = true,
    ["upgrade"] = true,
    ["x-pi-machine"] = true,
}

local cleared_headers = {
    "Authorization",
    "Cookie",
    "Origin",
    "Referer",
    "Sec-Fetch-Dest",
    "Sec-Fetch-Mode",
    "Sec-Fetch-Site",
    "Sec-Fetch-User",
    "X-Pi-Machine",
}

local header_punctuation = {
    ["!"] = true, ["#"] = true, ["$"] = true, ["%"] = true,
    ["&"] = true, ["'"] = true, ["*"] = true, ["+"] = true,
    ["-"] = true, ["."] = true, ["^"] = true, ["_"] = true,
    ["`"] = true, ["|"] = true, ["~"] = true,
}

local function invalid(message)
    error("Invalid fleet config: " .. message, 0)
end

local function trim(value)
    return value:match("^%s*(.-)%s*$")
end

local function valid_header_name(name)
    if type(name) ~= "string" or name == "" then return false end
    for index = 1, #name do
        local byte = name:byte(index)
        local character = name:sub(index, index)
        if not ((byte >= 48 and byte <= 57)
            or (byte >= 65 and byte <= 90)
            or (byte >= 97 and byte <= 122)
            or header_punctuation[character]) then
            return false
        end
    end
    return true
end

local function read_config()
    local inline = os.getenv("PI_FLEET_CONFIG_JSON")
    if inline and inline ~= "" then return inline end

    local path = os.getenv("PI_FLEET_CONFIG_FILE") or "/config/machines.json"
    local file, open_error = io.open(path, "rb")
    if not file then invalid("cannot read " .. path .. ": " .. tostring(open_error)) end
    local content = file:read("*a")
    file:close()
    return content
end

local function parse_url(id, value)
    if type(value) ~= "string" then invalid("machine " .. id .. " has an invalid API URL") end
    if value:sub(1, 7) ~= "http://" and value:sub(1, 8) ~= "https://" then
        invalid("machine " .. id .. " API URL must use HTTP or HTTPS")
    end
    if value:find("[%c%s]") or value:find("?", 1, true) or value:find("#", 1, true) then
        invalid("machine " .. id .. " API URL contains unsupported characters")
    end

    local authority = value:match("^https?://([^/]+)")
    if not authority or authority == "" or authority:find("@", 1, true) then
        invalid("machine " .. id .. " API URL has an invalid authority")
    end

    local server_name
    if authority:sub(1, 1) == "[" then
        server_name = authority:match("^%[([^%]]+)%]")
    else
        server_name = authority:match("^([^:]+)")
    end
    if not server_name or server_name == "" then invalid("machine " .. id .. " API URL has an invalid host") end

    return value:gsub("/+$", ""), authority, server_name
end

local function parse_headers(id, value)
    if value == nil then return {}, nil end
    if type(value) ~= "table" then invalid("machine " .. id .. " has invalid API headers") end

    local parsed = {}
    local seen = {}
    local host
    for name, header_value in pairs(value) do
        if not valid_header_name(name) then invalid("machine " .. id .. " has an invalid API header name") end
        local normalized = name:lower()
        if seen[normalized] then invalid("machine " .. id .. " has a duplicate API header: " .. name) end
        if forbidden_headers[normalized] then invalid("machine " .. id .. " uses a forbidden API header: " .. name) end
        if type(header_value) ~= "string" or header_value:find("[\r\n]") then
            invalid("machine " .. id .. " has an invalid API header value: " .. name)
        end
        seen[normalized] = true
        if normalized == "host" then
            host = header_value
        else
            parsed[#parsed + 1] = { name = name, value = header_value }
        end
    end
    return parsed, host
end

function M.load()
    local config, decode_error = cjson.decode(read_config())
    if not config then invalid("invalid JSON: " .. tostring(decode_error)) end
    if type(config) ~= "table" or type(config.machines) ~= "table" then
        invalid("root object must contain a machines array")
    end

    local next_machines = {}
    local next_public = {}
    for index, value in ipairs(config.machines) do
        if type(value) ~= "table" then invalid("machine #" .. index .. " is invalid") end
        local id = type(value.id) == "string" and trim(value.id) or value.id
        local name = type(value.name) == "string" and trim(value.name) or value.name
        if type(id) ~= "string" or #id > 64 or not id:match("^[%w][%w._-]*$") then
            invalid("machine #" .. index .. " has an invalid id")
        end
        if next_machines[id] then invalid("duplicate machine id: " .. id) end
        if type(name) ~= "string" or name == "" or #name > 80 then
            invalid("machine " .. id .. " has an invalid name")
        end
        if value.enabled ~= nil and type(value.enabled) ~= "boolean" then
            invalid("machine " .. id .. " has an invalid enabled value")
        end
        if type(value.api) ~= "table" then invalid("machine " .. id .. " has an invalid API config") end

        local url, authority, server_name = parse_url(id, value.api.url)
        local headers, configured_host = parse_headers(id, value.api.headers)
        local enabled = value.enabled ~= false
        next_machines[id] = {
            enabled = enabled,
            url = url,
            host = configured_host or authority,
            server_name = server_name,
            headers = headers,
        }
        next_public[#next_public + 1] = { id = id, name = name, enabled = enabled }
    end

    machines = next_machines
    public_machines = next_public
end

local function respond(status, body)
    ngx.status = status
    ngx.header["Content-Type"] = "application/json; charset=utf-8"
    ngx.header["Cache-Control"] = "no-store"
    ngx.say(cjson.encode(body))
    return ngx.exit(status)
end

function M.list()
    return respond(ngx.HTTP_OK, { machines = public_machines })
end

function M.select()
    local request_uri = ngx.var.request_uri
    local machine_id
    local events_prefix = "/api/fleet/events/"
    if ngx.var.uri:sub(1, #events_prefix) == events_prefix then
        local events_path = request_uri:sub(#events_prefix + 1)
        local separator = events_path:find("/", 1, true)
        if not separator then
            return respond(ngx.HTTP_BAD_REQUEST, { error = "Invalid fleet event path" })
        end
        machine_id = ngx.unescape_uri(events_path:sub(1, separator - 1))
        request_uri = "/api" .. events_path:sub(separator)
    else
        machine_id = ngx.req.get_headers()["x-pi-machine"]
    end
    if type(machine_id) ~= "string" or machine_id == "" then
        return respond(ngx.HTTP_BAD_REQUEST, { error = "Missing X-Pi-Machine header" })
    end

    local machine = machines[machine_id]
    if not machine or not machine.enabled then
        return respond(ngx.HTTP_NOT_FOUND, { error = "Machine not found or disabled" })
    end

    local proxy_prefix = "/api/fleet/proxy/"
    if request_uri:sub(1, #proxy_prefix) == proxy_prefix then
        request_uri = "/api/" .. request_uri:sub(#proxy_prefix + 1)
    end

    for _, name in ipairs(cleared_headers) do ngx.req.clear_header(name) end
    for _, header in ipairs(machine.headers) do ngx.req.set_header(header.name, header.value) end

    ngx.var.fleet_target = machine.url .. request_uri
    ngx.var.fleet_host = machine.host
    ngx.var.fleet_server_name = machine.server_name
end

return M
