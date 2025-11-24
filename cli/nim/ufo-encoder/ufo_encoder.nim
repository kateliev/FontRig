# SCRIPT: UFO-Encoder
# NOTE: A tool to set encoding of a .designspace + UFO project
# NOTE: given a predefined configuration file.
# -----------------------------------------------------------
# (C) Vassil Kateliev, 2025    (http://www.kateliev.com)
# -----------------------------------------------------------

import std/[os, json, strutils, sequtils, tables, times, logging, parseopt, xmlparser, xmltree, streams]
import std/threadpool

# - Init ----------------------------------------------------
const
  Version = "1.0"
  ToolName = "UFO-ENCODER"
  GlyphSuffixSeparator = "."

type
  EncodingConfig = Table[string, seq[int]]
  
  UFOSource = object
    filename: string
    layerName: string
    styleName: string
    path: string

# - Helper functions -------------------------------------------
proc lineExtractor(source: string, delimiter: string): string =
  let parts = source.split(delimiter)
  if parts.len > 1:
    return parts[1].strip()
  return ""

proc nameFixer(glyphName: string): string =
  # Fix glyph names starting with digits
  result = glyphName
  if result.len > 0 and result[0].isDigit:
    result = "_" & result

proc parseTextProto(filePath: string): EncodingConfig =
  result = initTable[string, seq[int]]()
  
  if not filePath.endsWith(".textproto"):
    raise newException(IOError, "Not a .textproto file: " & filePath)
  
  let content = readFile(filePath)
  let lines = content.splitLines()
  
  var
    currentKey = ""
    currentValue = 0
    inBlock = false
  
  for line in lines:
    let trimmed = line.strip()
    
    if "key:" in trimmed:
      currentKey = lineExtractor(trimmed, ":").strip(chars = {'"', ' '})
      inBlock = true
    elif "value:" in trimmed and inBlock:
      let valueStr = lineExtractor(trimmed, ":").strip()
      currentValue = parseInt(valueStr)
      
      let fixedName = nameFixer(currentKey)
      if fixedName notin "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ":
        if not result.hasKey(fixedName):
          result[fixedName] = @[]
        result[fixedName].add(currentValue)
      
      inBlock = false
      currentKey = ""

proc parseSimpleYamlAlias(filePath: string): Table[string, string] =
  # Simple YAML parser for alias files
  result = initTable[string, string]()
  
  let content = readFile(filePath)
  let lines = content.splitLines()
  
  var 
    inRlig = false
  
  for line in lines:
    let trimmed = line.strip()
    if trimmed == "" or trimmed.startsWith("#"):
      continue
    
    # Check for rlig section
    if "rlig:" in trimmed:
      inRlig = true
      continue
    
    if inRlig:
      # Check indentation to see if we're still in rlig
      var leadingSpaces = 0
      for ch in line:
        if ch == ' ' or ch == '\t':
          leadingSpaces += 1
        else:
          break
      
      if leadingSpaces == 0 and trimmed != "" and trimmed != "rlig:":
        # We've left the rlig section
        inRlig = false
        continue
      
      # Parse key: value pairs
      if ":" in trimmed:
        let parts = trimmed.split(":", 1)
        if parts.len == 2:
          let
            key = parts[0].strip().strip(chars = {'"', '\''})
            value = parts[1].strip().strip(chars = {'"', '\''})
          
          if key != "" and value != "":
            result[key] = value

proc parseDesignspace(filePath: string): seq[UFOSource] =
  result = @[]
  
  let
    ds = loadXml(filePath)
    baseDir = parentDir(filePath)
    sources = ds.findAll("source")


  for source in sources:
    var ufoSource = UFOSource()

    # --- Get filename (it's an attribute, not a child) ---
    ufoSource.filename = source.attr("filename")
    if ufoSource.filename != "":
      ufoSource.path = baseDir / ufoSource.filename

    # --- Get layer name ---
    if source.attr("name") != "":
      ufoSource.layerName = source.attr("name")
    
    if source.attr("stylename") != "":
      ufoSource.styleName = source.attr("stylename")

    if ufoSource.filename != "":
      result.add(ufoSource)
    
proc readGlyphUnicodes(glyphPath: string): seq[int] =
  result = @[]
  
  if not fileExists(glyphPath):
    return result
  
  try:
    let xml = loadXml(glyphPath)
    let unicodes = xml.findAll("unicode")
    
    for unicode in unicodes:
      let hexValue = unicode.attr("hex")
      if hexValue != "":
        result.add(parseHexInt(hexValue))
  except:
    discard

proc writeGlyphUnicodes(glyphPath: string, unicodes: seq[int]) =
  if not fileExists(glyphPath):
    return
  
  try:
    var xml = loadXml(glyphPath)
    
    # Remove existing unicode elements
    var toRemove: seq[XmlNode] = @[]
    for child in xml:
      if child.kind == xnElement and child.tag == "unicode":
        toRemove.add(child)
    
    for node in toRemove:
      xml.delete(xml.find(node))
    
    # Add new unicode elements
    for unicode in unicodes:
      var unicodeNode = newElement("unicode")
      unicodeNode.attrs = {"hex": unicode.toHex(4)}.toXmlAttributes
      xml.insert(unicodeNode, 0)
    
    # Save the modified XML
    let fs = newFileStream(glyphPath, fmWrite)
    fs.write(xml)
    fs.close()
  except:
    error "Failed to write unicodes to: " & glyphPath

proc processGlyph(glyphName: string, glyphPath: string, encodingConfig: EncodingConfig, 
                  forceSuffixes: seq[string], mode: string): (string, bool, seq[int]) =
  result = (glyphName, false, @[])
  
  if mode == "clean":
    if fileExists(glyphPath):
      writeGlyphUnicodes(glyphPath, @[])
      result[1] = true
    return
  
  let currentUnicodes = readGlyphUnicodes(glyphPath)
  
  if mode == "extract":
    result[2] = currentUnicodes
    return
  
  if mode == "report":
    result[2] = currentUnicodes
    return
  
  # Normal encoding mode
  var newUnicodes: seq[int] = @[]
  
  # Handle forced suffixes
  if GlyphSuffixSeparator in glyphName and forceSuffixes.len > 0:
    let parts = glyphName.split(GlyphSuffixSeparator, 1)
    if parts.len == 2:
      let baseName = parts[0]
      let suffix = parts[1]
      
      if suffix in forceSuffixes and encodingConfig.hasKey(baseName):
        newUnicodes = encodingConfig[baseName]
  elif encodingConfig.hasKey(glyphName):
    newUnicodes = encodingConfig[glyphName]
  else:
    return
  
  # Only update if different
  if currentUnicodes != newUnicodes:
    writeGlyphUnicodes(glyphPath, newUnicodes)
    result[1] = true

# - Processing --------------------------------------------------
proc processUFOSource(source: UFOSource, encodingConfig: EncodingConfig, 
                      forceSuffixes: seq[string], mode: string): (int, Table[string, seq[int]]) =
  var
    encodedCount = 0
    extractedData = initTable[string, seq[int]]()
  
  let glyphsDir = source.path / "glyphs"
  
  if not dirExists(glyphsDir):
    error "Glyphs directory not found: " & glyphsDir
    return (0, extractedData)
  
  # Read contents.plist to get glyph list
  let contentsPath = glyphsDir / "contents.plist"
  if not fileExists(contentsPath):
    error "contents.plist not found: " & contentsPath
    return (0, extractedData)
  
  # Parse contents.plist
  let contentsXml = loadXml(contentsPath)
  var glyphFiles: seq[(string, string)] = @[]
  
  # Find the dict containing glyph mappings
  let dict = contentsXml.findAll("dict")[0]
  var isKey = true
  var currentKey = ""
  
  for node in dict:
    if node.kind == xnElement:
      if node.tag == "key" and isKey:
        currentKey = node.innerText
        isKey = false
      elif node.tag == "string" and not isKey:
        glyphFiles.add((currentKey, node.innerText))
        isKey = true
  
  # Process glyphs in parallel for better performance
  var futures: seq[FlowVar[(string, bool, seq[int])]] = @[]
  
  for (glyphName, glyphFile) in glyphFiles:
    let glyphPath = glyphsDir / glyphFile
    futures.add(spawn processGlyph(glyphName, glyphPath, encodingConfig, forceSuffixes, mode))
  
  # Collect results
  for future in futures:
    let (glyphName, wasEncoded, unicodes) = ^future
    if wasEncoded:
      encodedCount += 1
    if mode == "extract" and unicodes.len > 0:
      extractedData[glyphName] = unicodes
  
  return (encodedCount, extractedData)

proc ufoEncoder(designspacePath: string, encodingPath: string = "", 
                aliasPath: string = "", layerName: string = "", 
                outputPath: string = "", forceSuffixes: seq[string] = @[],
                extract: bool = false, clean: bool = false, 
                report: bool = false) =
  
  let startTime = epochTime()
  
  # Sanity checks
  if not fileExists(designspacePath):
    error "Invalid or missing UFO DesignSpace file: " & designspacePath
    quit(1)
  
  # Parse designspace
  let sources = parseDesignspace(designspacePath)
  info "Found " & $sources.len & " sources in designspace"
  
  # Load encoding configuration
  var encodingConfig = initTable[string, seq[int]]()
  
  if encodingPath != "":
    let (_, _, ext) = splitFile(encodingPath)
    
    case ext.toLower()
    of ".json":
      let jsonData = parseFile(encodingPath)
      for key, val in jsonData.pairs:
        var unicodes: seq[int] = @[]
        for unicode in val.items:
          unicodes.add(unicode.getInt())
        encodingConfig[key] = unicodes
    of ".textproto":
      encodingConfig = parseTextProto(encodingPath)
    else:
      error "Invalid configuration file format: " & ext
      quit(1)
    
    info "Loaded encoding with " & $encodingConfig.len & " entries"
  
  # Handle alias configuration with simple parser
  if aliasPath != "" and encodingConfig.len > 0:
    let aliasMap = parseSimpleYamlAlias(aliasPath)
    
    for alias, source in aliasMap.pairs:
      if encodingConfig.hasKey(alias) and encodingConfig.hasKey(source):
        encodingConfig[source] = encodingConfig[source] & encodingConfig[alias]
        encodingConfig.del(alias)
    
    # Remove duplicates
    for key in encodingConfig.keys:
      encodingConfig[key] = deduplicate(encodingConfig[key])
  
  # Determine mode
  var mode = "normal"
  if extract: mode = "extract"
  elif clean: mode = "clean"
  elif report: mode = "report"
  
  info "Working in " & mode & " mode"
  
  # Filter sources if layer name specified
  var processingSources = sources
  if layerName != "":
    #let layerNames = layerName.split(',').mapIt(it.strip())
    processingSources = sources.filterIt(it.layerName == layerName)
  
  # Process sources
  for source in processingSources:
    let (encodedCount, extractedData) = processUFOSource(
      source, encodingConfig, forceSuffixes, mode)
    
    info "Processed source: " & source.filename & " Glyphs modified:" & $encodedCount
    
    # Handle extraction output
    if extract and extractedData.len > 0:
      let exportPath = if outputPath != "": outputPath 
                       else: changeFileExt(designspacePath, "") & "-" & 
                             source.layerName.replace(" ", "_") & ".json"
      
      var jsonOutput = newJObject()
      for key, val in extractedData.pairs:
        jsonOutput[key] = %val
      
      writeFile(exportPath, $jsonOutput)
      info "Exported encoding data to: " & exportPath
  
  # Report results
  let elapsed = epochTime() - startTime
  info "Processed " & $processingSources.len & " sources in " & formatFloat(elapsed, ffDecimal, 2) & " seconds"

# - Run -------------------------------------
when isMainModule:
  var
    designspacePath = ""
    encodingPath = ""
    aliasPath = ""
    layerName = ""
    outputPath = ""
    forceSuffixStr = ""
    extract = false
    clean = false
    report = false
  
  # Parse command line arguments
  var p = initOptParser()
  
  while true:
    p.next()
    case p.kind
    of cmdEnd: break
    of cmdShortOption, cmdLongOption:
      case p.key
      of "e", "encoding": encodingPath = p.val
      of "a", "alias": aliasPath = p.val
      of "l", "layer": layerName = p.val
      of "o", "output": outputPath = p.val
      of "f", "force": forceSuffixStr = p.val
      of "x", "extract": extract = true
      of "c", "clean": clean = true
      of "r", "report": report = true
      of "h", "help":
        echo ToolName & " v" & Version
        echo "Usage: ufo_encoder <designspace> [options]"
        echo "Options:"
        echo "  -e, --encoding <path>   Configuration file for encoding"
        echo "  -a, --alias <path>      Alias configuration file"
        echo "  -l, --layer <name>      Layer/Source to process"
        echo "  -o, --output <path>     Output path for extracted data"
        echo "  -f, --force <suffixes>  Force encoding of alternates"
        echo "  -x, --extract           Extract encoding information"
        echo "  -c, --clean             Remove all encoding"
        echo "  -r, --report            Report non-encoded glyphs"
        quit(0)
    of cmdArgument:
      if designspacePath == "":
        designspacePath = p.key
  
  if designspacePath == "":
    echo "Error: No designspace file specified"
    echo "Use -h for help"
    quit(1)
  
  # Setup logging
  var logger = newConsoleLogger(fmtStr = "[$time] [$levelname] $msg")
  addHandler(logger)
  
  # Process force suffixes
  let forceSuffixes = if forceSuffixStr != "": 
                        forceSuffixStr.split(',').mapIt(it.strip())
                      else: @[]
  
  # Run encoder
  ufoEncoder(designspacePath, encodingPath, aliasPath, layerName, 
             outputPath, forceSuffixes, extract, clean, report)
