# FR-MOD-V-METRICS
## Requirements
Python3, FontTools

## Description
A command line tool for modifying the vertical font metrics of one or multiple font files.

## Usage
```
usage: FR-MOD-V-METRICS [-h] [--output-path path] [--input-metrics path] [--report-metrics] [--dump-metrics] [--sTypoAscender int] [--sTypoDescender int] [--usWinAscent int] [--usWinDescent int] [--sTypoLineGap int] [--sxHeight int] [--sCapHeight int] [--ascent int] [--descent int] [--lineGap int] [--yMax int] [--yMin int] [--unitsPerEm int] [--version] font files

FontRig | Modify the vertical metrics of a *.ttf or *.otf file

positional arguments:
  font file(s)                      A *.ttf or *.otf font file(s)

optional arguments:
  -h, --help                        show this help message and exit
  --output-path path, -o path
                                    Optional output folder
  --input-metrics path, -m path     Vertical metrics config file in *.JSON format
  --report-metrics, -r              Report file metrics
  --dump-metrics, -d                Dump file metrics in *.JSON format
  --sTypoAscender int               Set font OS/2 sTypoAscender value
  --sTypoDescender int              Set font OS/2 sTypoDescender value
  --usWinAscent int                 Set font OS/2 usWinAscent value
  --usWinDescent int                Set font OS/2 usWinDescent value
  --sTypoLineGap int                Set font OS/2 sTypoLineGap value
  --sxHeight int                    Set font OS/2 sxHeight value
  --sCapHeight int                  Set font OS/2 sCapHeight value
  --ascent int                      Set font HHEA ascent value
  --descent int                     Set font HHEA descent value
  --lineGap int                     Set font HHEA lineGap value
  --yMax int                        Set font HEAD yMax value
  --yMin int                        Set font HEAD yMin value
  --unitsPerEm int                  Set font HEAD unitsPerEm value
  --version, -v                     Show tool version.

```