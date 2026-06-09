# Generates the Italian two-voice test fixture using Windows TTS.
Add-Type -AssemblyName System.Speech
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$out = Join-Path $PSScriptRoot "..\test\fixtures\italian-two-speakers.wav"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$s.SetOutputToWaveFile($out, $fmt)
function Say($synth, $voice, $text) {
  $pb = New-Object System.Speech.Synthesis.PromptBuilder
  $pb.StartVoice($voice)
  $pb.AppendText($text)
  $pb.AppendBreak([TimeSpan]::FromSeconds(1.6))
  $pb.EndVoice()
  $synth.Speak($pb)
}
Say $s 'Microsoft Elsa Desktop' 'Buongiorno a tutti, benvenuti alla riunione di oggi. Parleremo del nuovo progetto.'
Say $s 'Microsoft Zira Desktop' 'Grazie mille, sono molto contenta di partecipare a questa riunione.'
Say $s 'Microsoft Elsa Desktop' 'Perfetto, allora iniziamo subito con il primo punto.'
$s.Dispose()
Get-Item $out | Select-Object FullName, Length
