try {
  const portAudio = require('naudiodon');
  console.log('---------------------------------------------------');
  console.log('Audio Library (naudiodon) loaded successfully!');
  console.log('---------------------------------------------------');
  
  const devices = portAudio.getDevices();
  console.log(`Found ${devices.length} audio devices:`);
  
  devices.forEach((d, i) => {
    // We are looking for input devices (maxInputChannels > 0)
    if (d.maxInputChannels > 0) {
      console.log(`\n[${i}] ${d.name}`);
      console.log(`    ID: ${d.id}`);
      console.log(`    Input Channels: ${d.maxInputChannels}`);
      console.log(`    Default Sample Rate: ${d.defaultSampleRate}`);
      
      // Check for keywords that suggest loopback capability
      const lowerName = d.name.toLowerCase();
      if (lowerName.includes('loopback') || lowerName.includes('stereo mix')) {
        console.log('    *** POTENTIAL LOOPBACK DEVICE ***');
      }
    }
  });
  console.log('\n---------------------------------------------------');
} catch (e) {
  console.error('\nERROR: Could not load "naudiodon".');
  console.error('It seems the audio library is not installed correctly.');
  console.error('Error details:', e.message);
  console.error('\nPlease follow the installation instructions to fix this.');
}
