@echo off
echo Building UFO Encoder...

nim c -d:release --opt:speed -o:ufo_encoder.exe ufo_encoder.nim

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Build successful!
    echo Binary: ufo_encoder.exe
    echo.
    echo Testing help:
    ufo_encoder.exe -h
) else (
    echo.
    echo Build failed! Trying without optimizations...
    nim c -o:ufo_encoder_debug.exe ufo_encoder_minimal.nim
)

pause
