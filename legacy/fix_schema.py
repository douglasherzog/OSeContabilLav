import re
with open("electron/main.js", "r", encoding="utf-8") as f:
    content = f.read()

# Remove DEFAULT (datetime("now")) from CREATE TABLE statements
content = re.sub(r' DEFAULT \(datetime\(["\x27]now["\x27]\)\)', '', content)

with open("electron/main.js", "w", encoding="utf-8") as f:
    f.write(content)
print("OK")
