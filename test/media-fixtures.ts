import sharp from 'sharp'

export async function createTestImage(format: 'png' | 'jpeg' | 'gif' | 'webp' = 'png', color = '#d17a31') {
  return sharp({ create: { width: 2, height: 3, channels: 4, background: color } }).toFormat(format).toBuffer()
}

export async function createTestAnimation(format: 'gif' | 'webp') {
  const pixels = Buffer.from([
    255, 0, 0, 255, 0, 0, 0, 0,
    0, 0, 255, 128, 0, 0, 0, 0,
  ])
  const image = sharp(pixels, { raw: { width: 2, height: 2, channels: 4, pageHeight: 1 } })
  return format === 'gif'
    ? image.gif({ delay: [80, 160], loop: 2 }).toBuffer()
    : image.webp({ lossless: true, delay: [80, 160], loop: 2 }).toBuffer()
}
