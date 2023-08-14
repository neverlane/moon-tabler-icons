import { parse } from 'https://deno.land/std@0.86.0/flags/mod.ts';

const args = parse(Deno.args, {
  string: [ 'v' ],
  default: {
    v: '1.0.1'
  }
});

const lib_version = (args.v ?? '1.0.1') as string;

const unic = (str: string) => new TextEncoder().encode(str).reduce((f, c) => (f += '\\x' + c.toString(16)), '');

async function getIconsVersion() {
  const response = await fetch('https://raw.githubusercontent.com/tabler/tabler-icons/master/package.json');
  const json = await response.json();
  return json.version as string;
}

async function getIconicFontCompressedBase85() {
  const arr = await fetch('https://github.com/tabler/tabler-icons/raw/master/packages/icons-webfont/fonts/tabler-icons.ttf').then(res => res.arrayBuffer());
  await Deno.writeFile('.cache/tabler-icons.ttf', new Uint8Array(arr));
  const b2c_lua = Deno.run({
    cmd: ['./tools/b2c_lua.exe', '-base85', '.cache/tabler-icons.ttf', 'tabler_icons_font'],
    stdout: 'piped',
  });
  const [,stdout] = await Promise.all([
    b2c_lua.status(),
    b2c_lua.output()
  ]);
  return new TextDecoder().decode(stdout);
}

async function getIcons() {
  const response = await fetch('https://raw.githubusercontent.com/tabler/tabler-icons/master/packages/icons-webfont/tabler-icons.css');
  const css = await response.text();
  const icons_css_regexp = /\.ti-(?<name>[\w-]+):before\s*\{\s*content:\s*"\\(?<unicode>[^"]+)";\s*}/gi;
  const rawIcons = Array.from(css.matchAll(icons_css_regexp));
  const icons = rawIcons.map((rawIcon) => (rawIcon.shift(), rawIcon as string[]));
  return icons;
}

function getIconsRanges(icons: string[][]) {
  return icons.map(icon => parseInt(icon[1], 16))
    .sort((a, b) => a - b)
    .filter((_number, idx, arr) => idx === 0 || idx + 1 === arr.length);
}

const _icons = await getIcons();
const icons = {
  items: _icons,
  version: await getIconsVersion(),
  ranges: await getIconsRanges(_icons)
}

let lua_code = '';

// lib info
lua_code += `
-- Tabler Icons Lua
-- Version: ${lib_version}
-- Icons version: ${icons.version}
`;

// lib iconic font
lua_code += `\n${await getIconicFontCompressedBase85()}`;

// lua
lua_code += `
local MIN_ICON, MAX_ICON = ${icons.ranges.join(', ')}
local mod = {
  __VERSION = '${lib_version}';
  __ICONS_VERSION = '${icons.version}';
  min_range = MIN_ICON;
  max_range = MAX_ICON;
  get_font_data_base85 = function()
    return tabler_icons_font_compressed_data_base85
  end;
}`;

const createIconName = (str: string) => `ICON_${str.replaceAll('-', '_').toUpperCase()}`

// icons
lua_code += '\ndo';
for (const [iconName, iconUnicode] of icons.items)
  lua_code += `\n  mod['${createIconName(iconName)}'] = '${unic(String.fromCharCode(parseInt(iconUnicode, 16)))}'`;
lua_code += '\nend';

lua_code += `
local function unicode_to_utf8(code)
-- converts numeric UTF code (U+code) to UTF-8 string
local t, h = {}, 128
while code >= h do
  t[#t+1] = 128 + code%64
  code = math.floor(code/64)
  h = h > 32 and 32 or h/2
end
t[#t+1] = 256 - 2*h + code
return string.char(unpack(t)):reverse()
end

setmetatable(mod, {
__call = function(t, v)
  if (type(v) == 'string') then
    return t['ICON_'..v:upper():gsub('-','_')] or '?'
  elseif (type(v) == 'number' and v >= MIN_ICON and v <= MAX_ICON) then
    return unicode_to_utf8(v)
  end
  return '?'
end
})

return mod`;

Deno.writeFile(`./lua/tabler-icons-v${icons.version}.lua`, new TextEncoder().encode(lua_code));

console.log('ok');
