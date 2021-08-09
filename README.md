# FontRig
An collection of assorted tools for manipulating fonts.

## Command line tools
### Python
[FR-MOD-V-METRICS](./doc/fr-mod-v-metrics.md) A command line tool for modifying the vertical font metrics of one or multiple font files (*.otf, *.ttf). Example: `python.exe fr-mod-v-metrics.py *.ttf -m .\new-v-metrics.json -o .\new-metrics`


## GUI Tools
### Python
**fr-kern-job-composer** A Gui tool for managing DTL kern class files (*.cla) as well as UFO kern groups (*.plist) for composing lists of pairs to be kerned (*.krn) using DTL KernMaster.