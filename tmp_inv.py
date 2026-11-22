import os, pathlib, re, py_compile
rows=[]
for r,ds,fs in os.walk("/Users"):
    if any(x in r for x in ("node_modules","/Library/.","/usr/","/System","/Applications","/private","/var/","/etc/")): ds[:]=[]; continue
    p=pathlib.Path(r)
    if "apply_schema_fix.py" not in fs or not (p/".env").is_file(): continue
    e=(p/".env").read_text(errors="ignore")
    m=re.search(r"SUPABASE_ACCESS_TOKEN\s*=\s*['\"]?([^\s'\"]+)", e)
    url=re.search(r"SUPABASE_URL\s*=\s*['\"]?([^\s'\"]+)", e)
    if not m or not url: continue
    tok=m.group(1)
    if "/" in tok:  # base64 JWT
        prefix="JWT:"+tok[:6]+"..."
    else:
        prefix=tok[:6]+"..."
    src=(p/"apply_schema_fix.py").read_text(errors="ignore")
    has_desc = "analytics: security" in src
    try:
        py_compile.compile(str(p/"apply_schema_fix.py"), doraise=True); ok="PARSE-OK"
    except Exception:
        ok="BROKEN"
    rows.append((r, len(tok), prefix, bool(url), has_desc, ok))
def strip_home(x):
    return x.replace("/Users/vijaykumar","~U").replace("/Users/vijaykarumathi","~R").replace("/Users/vijaymaruthi","~M").replace("/Users/vijaykumar","~K")
print("── %d trees with ACCESS_TOKEN+URL" % len(rows))
for r,l,p,ur,d,ok in rows:
    print("   %-12s len=%-3s url=%-4s desc=%-4s %s" % (p,l,ur,d,ok))
    print("      %s" % strip_home(r))
SC="/Users/vijaykumar/projecs /opencode/share"
PY