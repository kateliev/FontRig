# FontRig playground — TypeRig core, in your browser.
#
# Tip: click Run (or double-click this script). All output appears
# in the console strip just above this panel.
#
# The `glyph` global is the currently active glyph, mirrored from
# the editor every time you Run. Mutations propagate back to the
# canvas, and one Run = one undo step.

from typerig.core.objects.glyph import Glyph

print("Glyph:   ", glyph.name)
print("Unicodes:", list(glyph.unicodes) if glyph.unicodes else "(none)")
print("Layers:  ", len(glyph.data))
print()

# Walk every layer / shape / contour / node.
for lyr in glyph.data:
    on, off = 0, 0
    for shape in lyr.shapes:
        for contour in shape.contours:
            for node in contour.data:
                if node.type == "on":
                    on += 1
                else:
                    off += 1
    print(f"  {lyr.name:<12}  shapes={len(lyr.shapes):>2}  "
          f"nodes on/off = {on}/{off}  width={lyr.width}")

print()
print("Try editing this script and Run again. A few things to try:")
print("  - glyph.data[0].shapes[0].contours[0].data[0].x += 50")
print("  - from typerig.core.actions.draw_actions import DrawActions")
print("  - help(glyph)")
