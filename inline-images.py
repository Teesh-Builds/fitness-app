# Prints exercises.js with image paths swapped for embedded data URIs (used by the single-file builds).
import base64, re, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
s = open('exercises.js').read()
def emb(m):
    p = m.group(1)
    return 'img: "data:image/jpeg;base64,' + base64.b64encode(open(p, 'rb').read()).decode() + '"'
sys.stdout.write(re.sub(r'img: "(images/[^"]+)"', emb, s))
