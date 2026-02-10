package main

import (
	_ "embed"
	"encoding/binary"
)

//go:embed assets/icon.png
var iconPNG []byte

//go:embed assets/icon-16.png
var iconSmallPNG []byte

// pngToICO wraps raw PNG bytes in an ICO container.
// ICO format supports PNG as the image payload (since Windows Vista).
func pngToICO(png []byte) []byte {
	// ICO header: 6 bytes
	// Directory entry: 16 bytes
	// Then the PNG payload
	ico := make([]byte, 6+16+len(png))

	// Header
	binary.LittleEndian.PutUint16(ico[0:], 0)     // reserved
	binary.LittleEndian.PutUint16(ico[2:], 1)     // type: 1 = ICO
	binary.LittleEndian.PutUint16(ico[4:], 1)     // image count

	// Directory entry
	ico[6] = 0  // width (0 = 256)
	ico[7] = 0  // height (0 = 256)
	ico[8] = 0  // color palette count
	ico[9] = 0  // reserved
	binary.LittleEndian.PutUint16(ico[10:], 1)    // color planes
	binary.LittleEndian.PutUint16(ico[12:], 32)   // bits per pixel
	binary.LittleEndian.PutUint32(ico[14:], uint32(len(png))) // image size
	binary.LittleEndian.PutUint32(ico[18:], 22)   // offset to image data (6+16)

	// PNG payload
	copy(ico[22:], png)

	return ico
}
