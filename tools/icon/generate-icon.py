import math, cairosvg, sys

SKIN = "#F3CBA5"; SKIN_SH = "#E2B48C"
FRAME = "#2A2A35"
BROWN = "#6B4226"; BROWN_HI="#835233"
BLOND_M = "#E6C065"; BLOND_D1 = "#EFCB72"; BLOND_D2 = "#DDB458"

def wave(x0, y0, x1, y1, n, amp, phase=0):
    # quadratic wiggles from (x0,y0) to (x1,y1), perpendicular amplitude amp
    pts=[]
    dx, dy = (x1-x0)/n, (y1-y0)/n
    L = math.hypot(x1-x0,y1-y0); nx, ny = -(y1-y0)/L, (x1-x0)/L
    s=""
    for i in range(n):
        ax, ay = x0+dx*(i+0.5), y0+dy*(i+0.5)
        sgn = 1 if (i+phase)%2==0 else -1
        cx, cy = ax+nx*amp*sgn, ay+ny*amp*sgn
        s += f" Q{cx:.1f},{cy:.1f} {x0+dx*(i+1):.1f},{y0+dy*(i+1):.1f}"
    return s

def figure(cx, cy, r, base, shirt, hair, style):
    out=[]
    w = 1.55*r; top = cy+1.05*r
    body = f'<path d="M{cx-w-0.15*r},{base} L{cx-w},{top+0.55*r} Q{cx-w},{top} {cx-w+0.55*r},{top} L{cx+w-0.55*r},{top} Q{cx+w},{top} {cx+w},{top+0.55*r} L{cx+w+0.15*r},{base} Z" fill="{shirt}"/>'
    # back hair
    if style=="mother":
        out.append(f'<path d="M{cx-1.13*r},{cy-0.05*r} A{1.13*r},{1.13*r} 0 0 1 {cx+1.13*r},{cy-0.05*r} L{cx+1.13*r},{cy+1.15*r} Q{cx+1.13*r},{cy+1.3*r} {cx+0.95*r},{cy+1.3*r} L{cx-0.95*r},{cy+1.3*r} Q{cx-1.13*r},{cy+1.3*r} {cx-1.13*r},{cy+1.15*r} Z" fill="{hair}"/>')
    if style=="d1":
        d = f"M{cx-1.12*r},{cy-0.05*r} A{1.12*r},{1.12*r} 0 0 1 {cx+1.12*r},{cy-0.05*r}"
        d += wave(cx+1.12*r, cy-0.05*r, cx+1.25*r, cy+1.75*r, 4, 0.13*r)
        d += f" Q{cx+0.9*r},{cy+1.95*r} {cx+0.55*r},{cy+1.7*r} L{cx-0.55*r},{cy+1.7*r} Q{cx-0.9*r},{cy+1.95*r} {cx-1.25*r},{cy+1.75*r}"
        d += wave(cx-1.25*r, cy+1.75*r, cx-1.12*r, cy-0.05*r, 4, 0.13*r, 1)
        out.append(f'<path d="{d} Z" fill="{hair}"/>')
    if style=="d2":
        # ponytail to the right, behind the head
        out.append(f'<path d="M{cx+0.55*r},{cy-0.85*r} C{cx+1.6*r},{cy-1.0*r} {cx+1.75*r},{cy+0.2*r} {cx+1.45*r},{cy+1.2*r} C{cx+1.35*r},{cy+0.55*r} {cx+1.05*r},{cy+0.05*r} {cx+0.8*r},{cy-0.25*r} Z" fill="{hair}"/>')
    out.append(body)
    if style=="d1":
        # wavy locks falling over the shoulders, a bit longer than shoulder length
        for sg in (-1,1):
            x_in, x_out = cx+sg*0.72*r, cx+sg*1.18*r
            d = f"M{x_in:.1f},{cy+0.2*r:.1f}" + wave(x_in, cy+0.2*r, x_in+sg*0.05*r, cy+1.85*r, 4, 0.08*r)
            d += f" Q{(x_in+x_out)/2:.1f},{cy+2.05*r:.1f} {x_out+sg*0.08*r:.1f},{cy+1.8*r:.1f}"
            d += wave(x_out+sg*0.08*r, cy+1.8*r, x_out, cy+0.0*r, 4, 0.1*r, 1) + " Z"
            out.append(f'<path d="{d}" fill="{hair}"/>')
    # neck
    out.append(f'<rect x="{cx-0.33*r}" y="{cy+0.6*r}" width="{0.66*r}" height="{0.6*r}" rx="{0.12*r}" fill="{SKIN_SH}"/>')
    # ears
    for s in (-1,1):
        out.append(f'<circle cx="{cx+s*0.97*r}" cy="{cy+0.08*r}" r="{0.17*r}" fill="{SKIN}"/>')
    # head
    out.append(f'<ellipse cx="{cx}" cy="{cy}" rx="{0.97*r}" ry="{1.03*r}" fill="{SKIN}"/>')
    # front hair
    if style=="father":
        out.append(f'<path d="M{cx-1.0*r},{cy+0.05*r} C{cx-1.1*r},{cy-1.25*r} {cx+1.1*r},{cy-1.35*r} {cx+1.0*r},{cy+0.0*r} L{cx+0.92*r},{cy-0.3*r} Q{cx+0.5*r},{cy-0.62*r} {cx-0.1*r},{cy-0.55*r} Q{cx-0.6*r},{cy-0.5*r} {cx-0.9*r},{cy-0.25*r} Z" fill="{hair}"/>')
    elif style in ("mother","d1"):
        out.append(f'<path d="M{cx-1.02*r},{cy+0.35*r} C{cx-1.15*r},{cy-1.3*r} {cx+1.15*r},{cy-1.3*r} {cx+1.02*r},{cy+0.35*r} L{cx+0.86*r},{cy-0.2*r} Q{cx+0.6*r},{cy-0.62*r} {cx+0.12*r},{cy-0.7*r} Q{cx-0.45*r},{cy-0.45*r} {cx-0.9*r},{cy-0.05*r} Z" fill="{hair}"/>')
    elif style=="d2":
        out.append(f'<path d="M{cx-0.99*r},{cy-0.05*r} C{cx-1.05*r},{cy-1.3*r} {cx+1.05*r},{cy-1.3*r} {cx+0.99*r},{cy-0.05*r} Q{cx+0.75*r},{cy-0.6*r} {cx},{cy-0.68*r} Q{cx-0.75*r},{cy-0.6*r} {cx-0.99*r},{cy-0.05*r} Z" fill="{hair}"/>')
        out.append(f'<circle cx="{cx+0.9*r}" cy="{cy-0.55*r}" r="{0.13*r}" fill="#C0475A"/>')
    # glasses
    gy = cy+0.02*r; gr = 0.3*r; gx = 0.38*r; sw = 0.1*r
    for s in (-1,1):
        out.append(f'<circle cx="{cx+s*gx}" cy="{gy}" r="{gr}" fill="#FFFFFF" fill-opacity="0.35" stroke="{FRAME}" stroke-width="{sw}"/>')
        out.append(f'<circle cx="{cx+s*gx}" cy="{gy+0.02*r}" r="{0.075*r}" fill="{FRAME}"/>')
        out.append(f'<line x1="{cx+s*(gx+gr)}" y1="{gy-0.05*r}" x2="{cx+s*0.96*r}" y2="{gy-0.12*r}" stroke="{FRAME}" stroke-width="{sw*0.8}" stroke-linecap="round"/>')
    out.append(f'<path d="M{cx-gx+gr},{gy-0.04*r} Q{cx},{gy-0.16*r} {cx+gx-gr},{gy-0.04*r}" fill="none" stroke="{FRAME}" stroke-width="{sw*0.8}" stroke-linecap="round"/>')
    # smile + cheeks
    out.append(f'<path d="M{cx-0.28*r},{cy+0.5*r} Q{cx},{cy+0.75*r} {cx+0.28*r},{cy+0.5*r}" fill="none" stroke="#9A4A3A" stroke-width="{0.08*r}" stroke-linecap="round"/>')
    return "\n".join(out)

def family():
    base = 900
    parts=[]
    # house outline behind
    parts.append('<path d="M120,560 L512,215 L904,560" fill="none" stroke="#FFFFFF" stroke-opacity="0.9" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>')
    parts.append('<rect x="700" y="260" width="62" height="150" rx="10" fill="#FFFFFF" fill-opacity="0.9"/>')
    # parents (back)
    parts.append(figure(420, 470, 92, base, "#3E6FA8", BROWN, "father"))
    parts.append(figure(604, 492, 86, base, "#D9715F", BLOND_M, "mother"))
    # daughters (front)
    parts.append(figure(262, 590, 80, base, "#7FB069", BLOND_D1, "d1"))
    parts.append(figure(768, 600, 78, base, "#9B6FB5", BLOND_D2, "d2"))
    return "\n".join(parts)

BG = '<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E8B8F"/><stop offset="1" stop-color="#1F5F7A"/></linearGradient></defs>'

def svg(body, size=1024):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 1024 1024">{body}</svg>'

fam = family()
# legacy / store icon: full square background (launcher masks it)
icon = svg(BG + '<rect width="1024" height="1024" fill="url(#bg)"/>' + f'<g transform="translate(512 540) scale(0.86) translate(-512 -560)">{fam}</g>')
# adaptive foreground: transparent, content inside safe circle (r≈313)
fg = svg(f'<g transform="translate(512 520) scale(0.66) translate(-512 -557)">{fam}</g>')
bg = svg(BG + '<rect width="1024" height="1024" fill="url(#bg)"/>')
for name, s in [("icon", icon), ("adaptive-foreground", fg), ("adaptive-background", bg)]:
    open(f"{name}.svg","w").write(s)
    cairosvg.svg2png(bytestring=s.encode(), write_to=f"{name}.png", output_width=1024, output_height=1024)
# preview: masked circle like a launcher
prev = svg(f'<defs><clipPath id="c"><circle cx="512" cy="512" r="512"/></clipPath>{BG[6:-7]}</defs><g clip-path="url(#c)"><rect width="1024" height="1024" fill="url(#bg)"/><g transform="translate(512 520) scale(0.66) translate(-512 -557)">{fam}</g></g>')
cairosvg.svg2png(bytestring=prev.encode(), write_to="preview-round.png", output_width=512, output_height=512)
cairosvg.svg2png(bytestring=icon.encode(), write_to="preview-square.png", output_width=512, output_height=512)
cairosvg.svg2png(bytestring=prev.encode(), write_to="preview-48.png", output_width=96, output_height=96)
print("ok")
