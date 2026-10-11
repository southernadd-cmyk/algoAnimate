import { SOUND_FLOOR } from './features.js';
const db = value => value > 1e-7 ? (20 * Math.log10(value)).toFixed(1) + ' dBFS' : 'silence';
export const centroidReading = value => (value >= 1 ? '≥ 10,000' : Math.round(value * 10000).toLocaleString('en-GB')) + ' Hz centroid';
export class ListeningOverlay {
  constructor(element, routes) {
    this.element = element;
    this.summary = document.createElement('p'); this.summary.className = 'listening-summary';
    const title = document.createElement('h2'); title.textContent = 'How it listens';
    const note = document.createElement('p'); note.className = 'listening-note';
    note.textContent = 'FFT splits the spectrum into bands. RMS measures loudness. Spectral flux measures rising energy between frames. Each row drives three pens.';
    this.rows = routes.map(route => {
      const row = document.createElement('div'), name = document.createElement('strong'), output = document.createElement('output');
      name.textContent = route.name; row.append(name, output); element.append(row);
      return { route, row, output };
    });
    element.prepend(title, note, this.summary);
  }
  update(features, voices, replay = false) {
    const values = {
      bass: 'Bass 35–250 Hz · ' + db(features.bandRms.bass),
      mid: 'Mids 250–2,200 Hz · ' + db(features.bandRms.mid),
      treble: 'Treble 2,200–14,000 Hz · ' + db(features.bandRms.treble),
      level: 'Loudness (RMS) · ' + db(features.rms),
      centroid: 'Brightness · ' + centroidReading(features.raw.centroid),
      flux: 'Onsets / change · ' + (features.raw.flux * 100).toFixed(1) + '% positive flux'
    };
    this.summary.textContent = (replay ? 'Recorded features' : 'Live measurements') + ' · RMS gate '
      + (features.active ? 'open' : 'closed') + ' · floor ' + db(SOUND_FLOOR);
    this.rows.forEach(({ route, row, output }, i) => {
      output.textContent = route.inputs.map(key => values[key]).join(' + ');
      row.classList.toggle('listening-active', Boolean(voices[i]?.flowing));
      row.classList.toggle('listening-muted', voices[i]?.enabled === false);
    });
  }
}
