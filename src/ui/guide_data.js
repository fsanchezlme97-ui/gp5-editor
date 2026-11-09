"use strict";
/*
 * guide_data.js — content of the in-app guide (Spanish): what each block does,
 * what each parameter does (with text that follows its value), and for every
 * GP-5 model the real gear it emulates plus well-known players / songs.
 *
 * Artist references are kept to widely documented associations and are only
 * orientative: real rigs change from record to record. Keys of MODELS are the
 * model fxids from data/fxid_ring_gp5.json. Exposes window.GuideData.
 */
(() => {
  // ---------------------------------------------------------------- blocks
  const BLOCKS = {
    NR: {
      what: "Una puerta de ruido: deja pasar la señal cuando tocas y cierra el paso cuando la guitarra baja de un umbral, cortando el zumbido y el soplido entre notas.",
      tip: "Súbela solo lo justo para que no se oiga ruido al parar. Si cortas el final de las notas largas, bájala.",
    },
    PRE: {
      what: "Efectos antes de la distorsión: compresores, boosts, wah/filtros y cambios de tono. Al estar al principio, cambian cómo la guitarra «empuja» al resto de la cadena.",
      tip: "Un boost aquí satura más el ampli; un compresor iguala el volumen de las notas antes de distorsionar.",
    },
    DST: {
      what: "Pedales de overdrive, distorsión y fuzz. Recortan la onda de la guitarra para generar armónicos: poco recorte suena cálido, mucho suena agresivo.",
      tip: "Con poca ganancia y nivel alto sirve de «empuje» para un ampli ya saturado: así se consigue un sonido más definido que subiendo solo la ganancia.",
    },
    AMP: {
      what: "El modelo de amplificador: define el carácter principal del sonido (limpio, crunch o alta ganancia) y su ecualización.",
      tip: "Empieza con los tonos a las 12 (50) y ajusta la ganancia primero; luego corrige graves, medios y agudos.",
    },
    CAB: {
      what: "El gabinete (altavoces y micrófono) como respuesta al impulso (IR). Filtra los agudos ásperos de la distorsión y da el «cuerpo» del sonido.",
      tip: "Elige el gabinete que acompaña de verdad a tu ampli (p. ej. un 4x12 para Marshall o Mesa, un 2x12 para Fender o Vox).",
    },
    EQ: {
      what: "Ecualizador gráfico después del ampli: sube o baja bandas de frecuencia concretas para pulir el sonido final.",
      tip: "Mejor recortar que realzar. Un pequeño realce en 800 Hz–1,6 kHz ayuda a que la guitarra se oiga en la banda.",
    },
    MOD: {
      what: "Modulación: chorus, flanger, phaser, vibrato y trémolo. Un oscilador lento (LFO) mueve el tono, la fase o el volumen para dar movimiento.",
      tip: "Rate marca la velocidad y Depth la intensidad. Valores bajos suenan sutiles y profesionales.",
    },
    DLY: {
      what: "Delay o eco: repite lo que tocas tras un tiempo, con repeticiones que se van apagando.",
      tip: "Para que no ensucie, deja la mezcla (Mix) por debajo de 30 y sincroniza el tiempo con el tempo de la canción.",
    },
    RVB: {
      what: "Reverb: simula el espacio (habitación, sala, iglesia, muelle o placa) en el que suena el ampli.",
      tip: "Con distorsión, menos reverb: con un Mix de 10–20 basta para dar aire sin perder definición.",
    },
    "N->S": {
      what: "SnapTone: una captura NAM (Neural Amp Modeler) de un equipo real, cargada en el pedal. Si está activa sustituye al ampli y al gabinete.",
      tip: "Las capturas se suben con Valeton Suite. Busca capturas de equipos concretos en tone3000.com.",
    },
  };

  // ------------------------------------------------------------ parameters
  // what: what it does · bands: [[upToFraction, text], ...] over the param range
  const P = (what, bands) => ({ what, bands });
  const LEVEL = P("Nivel de salida del bloque. Iguálalo con el bloque apagado para que al encenderlo no haya un salto de volumen.",
    [[0.35, "Por debajo del volumen original: baja el nivel."], [0.65, "Cerca del volumen original (nivel unidad)."], [1, "Por encima del original: empuja al siguiente bloque."]]);
  const MIX = P("Cuánto efecto se mezcla con la señal original.",
    [[0.15, "Muy sutil: casi solo se nota al parar de tocar."], [0.35, "Presente pero discreto, ideal para tocar en banda."], [0.6, "Muy evidente."], [1, "El efecto domina: sonido ambiental o experimental."]]);
  const TRAIL = P("Si está activado, las repeticiones o la cola siguen sonando al apagar el bloque o cambiar de preset, en vez de cortarse en seco.", null);
  const TONE = P("Control de tono: más abierto da brillo y ataque, más cerrado da un sonido más oscuro y suave.",
    [[0.3, "Oscuro y redondo."], [0.65, "Equilibrado."], [1, "Brillante y con mordida."]]);

  const GENERIC = {
    VOL: LEVEL, Volume: LEVEL, Mix: MIX, Wet: P("Nivel de la señal procesada.", MIX.bands), Dry: P("Nivel de la señal original sin procesar. A 0 solo se oye el efecto.", null),
    Trail: TRAIL, Tone: TONE,
    Gain: P("Cantidad de saturación: cuánto se recorta la señal.",
      [[0.2, "Casi limpio: solo un poco de calidez."], [0.45, "Crunch: rompe al tocar fuerte."], [0.7, "Saturación de rock."], [1, "Saturación máxima: más sustain, más compresión y más ruido."]]),
    Bass: P("Graves: cuerpo y pegada en las notas bajas.", [[0.3, "Ajustado, sin retumbe: bueno para tocar con bajo."], [0.65, "Equilibrado."], [1, "Mucho cuerpo; con distorsión puede embarrar."]]),
    Middle: P("Medios: donde vive la guitarra en una mezcla.", [[0.3, "Medios recortados (sonido «scooped», típico del metal de los 80)."], [0.65, "Equilibrado."], [1, "Medios marcados: se oye por encima de la banda."]]),
    Treble: P("Agudos: brillo y definición del ataque.", [[0.3, "Apagado y suave."], [0.65, "Equilibrado."], [1, "Muy brillante; con distorsión puede sonar áspero."]]),
    PRES: P("Presencia: agudos altos en la etapa de potencia; abre el sonido y le da aire.", [[0.3, "Cerrado y cálido."], [0.65, "Equilibrado."], [1, "Abierto y brillante."]]),
    Bright: P("Interruptor de brillo: realza los agudos, sobre todo con el volumen bajo.", null),
    Depth: P("Intensidad del efecto de modulación.", [[0.3, "Suave."], [0.65, "Clara."], [1, "Extrema."]]),
    Rate: P("Velocidad del oscilador (LFO).", [[0.25, "Lenta: ondulación amplia."], [0.6, "Media."], [1, "Rápida: vibración o efecto «Leslie»."]]),
    Time: P("Tiempo entre la nota y su repetición, en milisegundos. Para ir a tempo: 60000 ÷ BPM es una negra.",
      [[0.08, "Slapback (< 120 ms): eco corto del rockabilly."], [0.3, "Corto–medio: engorda el sonido."], [0.6, "Repeticiones claramente separadas (estilo U2 o Pink Floyd)."], [1, "Largo: ambiental."]]),
    "F.Back": P("Feedback: cuántas veces se repite el eco.", [[0.2, "Una o dos repeticiones."], [0.5, "Varias repeticiones."], [0.8, "Larga cola de repeticiones."], [1, "Casi infinito: autooscilación."]]),
    Decay: P("Duración de la cola de reverb.", [[0.3, "Corta: espacio pequeño."], [0.65, "Media."], [1, "Larga: espacio enorme y ambiental."]]),
    Damp: P("Amortiguación de agudos en la cola: más alto suena más oscuro y menos metálico.", [[0.3, "Cola brillante."], [0.65, "Cola natural."], [1, "Cola oscura y suave."]]),
  };
  GENERIC.Feedback = GENERIC["F.Back"];

  const BY_BLOCK = {
    NR: {
      THRE: P("Umbral: el nivel por debajo del cual la puerta se cierra.",
        [[0.25, "Umbral bajo: solo corta ruido muy débil."], [0.6, "Medio: corta el zumbido de una distorsión normal."], [1, "Alto: silencio total entre notas, pero puede cortar notas suaves y finales."]]),
    },
    PRE: {
      Sustain: P("Cantidad de compresión: iguala notas fuertes y suaves y alarga las notas.", [[0.3, "Compresión ligera."], [0.65, "Compresión notable: country y funk."], [1, "Aplastado: sustain máximo, pierde dinámica."]]),
      Attack: P("Rapidez con que actúa el compresor: lento deja pasar el golpe de púa.", [[0.4, "Rápido: ataque suavizado."], [1, "Lento: se conserva el golpe de púa."]]),
      Clip: P("Nivel de entrada del compresor: más alto comprime antes.", null),
      "+3dB": P("Añade 3 dB más de empuje.", null),
      Sense: P("Sensibilidad del filtro: cuánto lo abre la fuerza con que tocas.", [[0.4, "Responde solo a ataques fuertes."], [1, "Muy sensible: se abre con cualquier nota."]]),
      Range: P("Recorrido de frecuencias del barrido.", null),
      Q: P("Resonancia del filtro: más alto, pico más estrecho y «vocal».", [[0.4, "Suave."], [1, "Muy resonante («cuac»)."]]),
      Mode: P("Tipo de filtro o dirección del barrido.", null),
      Low: P("Límite grave del barrido o voz grave.", null),
      High: P("Límite agudo del barrido o voz aguda.", null),
      Detune: P("Desafinación en centésimas: duplica la señal ligeramente desafinada, como una pista doblada.", [[0.3, "Muy sutil: ensancha."], [1, "Evidente: efecto chorus."]]),
      "H-VOL": P("Volumen de la voz aguda.", null),
      "L-VOL": P("Volumen de la voz grave.", null),
    },
    DST: {
      Fuzz: P("Cantidad de fuzz: el recorte casi cuadrado de los fuzz de los 60.", [[0.3, "Fuzz suave y rasgado; limpia con el volumen de la guitarra."], [0.7, "Fuzz clásico."], [1, "Fuzz máximo, lleno y con sustain."]]),
      Filter: P("Filtro del RAT: al contrario que un tono normal, al subirlo el sonido se vuelve más oscuro.", [[0.3, "Brillante y agresivo."], [0.65, "Equilibrado."], [1, "Oscuro y suave."]]),
      Blend: P("Mezcla de la señal limpia con la distorsionada (útil en bajo para no perder graves).", null),
    },
    AMP: {
      "Gain 1": P("Ganancia del primer canal o etapa.", GENERIC.Gain.bands),
      "Gain 2": P("Ganancia del segundo canal: en los «jumpered» se mezclan los dos.", GENERIC.Gain.bands),
      "Tone 1": P("Tono del primer canal.", TONE.bands), "Tone 2": P("Tono del segundo canal.", TONE.bands),
      "Tone Cut": P("Corte de agudos del AC30: al contrario que un Treble, más alto suena más oscuro.", [[0.3, "Brillante «chime»."], [0.65, "Equilibrado."], [1, "Oscuro."]]),
      Char: P("Carácter: cambia la respuesta y el brillo del Top Boost.", null),
      Edge: P("Edge: medios y mordida del Badcat.", GENERIC.Middle.bands),
      MidFreq: P("Frecuencia central del control de medios.", null),
      Balance: P("Equilibrio entre la pastilla o señal de entrada y el preamplificador.", null),
      "EQ Freq": P("Frecuencia del ecualizador paramétrico.", null),
      "EQ Q": P("Anchura de la banda: alto = más estrecha.", null),
      "EQ Gain": P("Realce o recorte en esa frecuencia.", null),
    },
    MOD: {
      "P.Delay": P("Pre-delay del flanger: el retardo base que marca el color del barrido.", null),
      "F.Back": P("Realimentación del flanger: más alto, más metálico y «jet».", [[0.3, "Suave."], [0.7, "Marcado."], [1, "Avión a reacción."]]),
      Bias: P("Bias: forma de la onda del trémolo, como en los amplificadores de válvulas antiguos.", null),
      Tone: TONE,
    },
    DLY: {
      "R-Mix": P("Mezcla del modulador en anillo sobre las repeticiones.", null),
      Freq: P("Frecuencia del modulador en anillo: sonidos metálicos o de campana.", null),
      "S-Depth": P("Profundidad del barrido de filtro sobre las repeticiones.", null),
      "S-Rate": P("Velocidad del barrido de filtro.", null),
    },
    RVB: {
      Mod: P("Modulación de la cola: la hace más ancha y etérea.", null),
    },
    CAB: {
      VOL: P("Nivel del gabinete.", LEVEL.bands),
    },
  };

  // EQ bands: text depends on frequency and on the sign of the value.
  function eqBand(name) {
    const m = /^([\d.]+)(k?)Hz$/.exec(name);
    if (!m) return null;
    const hz = Number(m[1]) * (m[2] ? 1000 : 1);
    const zone = hz < 100 ? "subgraves (retumbe)" : hz < 300 ? "graves (cuerpo y pegada)" : hz < 600 ? "medios-graves (calidez; en exceso, sonido «de caja»)"
      : hz < 1300 ? "medios (presencia en la mezcla)" : hz < 3500 ? "medios-agudos (ataque y definición)" : "agudos (brillo y aire)";
    return { what: `Banda de ${name}: ${zone}.`, eq: true };
  }

  function param(block, name) {
    const b = block === "N->S" ? "NS" : block;
    return (BY_BLOCK[b] && BY_BLOCK[b][name]) || (block === "EQ" && eqBand(name)) || GENERIC[name] || null;
  }

  // ---------------------------------------------------------------- models
  // desc: what it is · refs: [{who, songs}] · pair: suggested partner
  const MODELS = {
    // NR
    27: { desc: "Basado en el ISP Decimator, una puerta de ruido muy rápida y transparente, estándar en el metal y la alta ganancia.", refs: [{ who: "Estilo: riffs con cortes secos y silencios entre acordes", songs: ["«Master of Puppets» — Metallica (estilo)"] }] },
    // PRE
    0: { desc: "Basado en el Ross Compressor, un compresor de los 70 de sonido cálido y algo coloreado. Muy usado en country y funk.", refs: [{ who: "Trey Anastasio (Phish)", songs: [] }] },
    1: { desc: "Basado en el Keeley Compressor, una versión más silenciosa y transparente del clásico Ross/Dyna Comp.", refs: [{ who: "Estilo: country «chicken pickin'» y funk limpio", songs: [] }] },
    26: { desc: "Basado en el Xotic EP Booster, que reproduce la etapa de previo del eco de cinta Echoplex EP-3: añade empuje y un brillo característico.", refs: [{ who: "El previo del Echoplex EP-3 forma parte del sonido de Eddie Van Halen y Jimmy Page", songs: [] }] },
    20: { desc: "Basado en el MXR Micro Amp: un boost limpio que sube el volumen sin colorear apenas el sonido.", refs: [{ who: "Estilo: subir el volumen para los solos o empujar un ampli saturado", songs: [] }] },
    11: { desc: "Basado en el Xotic BB Preamp: un boost con algo de saturación y control de graves y agudos.", refs: [] },
    16777231: { desc: "Filtro de envolvente (auto-wah): el filtro se abre según la fuerza con que tocas, al estilo del Mu-Tron III.", refs: [{ who: "Jerry Garcia (Grateful Dead) con el Mu-Tron III", songs: ["«Shakedown Street» — Grateful Dead"] }, { who: "Estilo: funk", songs: [] }] },
    16777237: { desc: "Wah tipo Cry Baby. Como el GP-5 no tiene pedal de expresión, aquí el barrido es automático (Rate).", refs: [{ who: "Jimi Hendrix", songs: ["«Voodoo Child (Slight Return)»"] }, { who: "Slash", songs: ["«Sweet Child O' Mine» (solo)"] }, { who: "Kirk Hammett (Metallica)", songs: ["«Enter Sandman» (solo)"] }] },
    16777249: { desc: "Octavador: añade una octava grave y/o aguda a lo que tocas.", refs: [{ who: "Jack White (The White Stripes), con una octava grave", songs: ["«Seven Nation Army»"] }] },
    16777251: { desc: "Cambiador de tono (pitch shifter): genera voces a otros intervalos, como un Whammy fijo.", refs: [{ who: "Tom Morello (Rage Against the Machine), con un Whammy", songs: ["«Killing in the Name» (solo)"] }] },
    16777257: { desc: "Desafinador: duplica la señal un poco desafinada para ensancharla, como una guitarra doblada en estudio.", refs: [] },
    // DST
    50331648: { desc: "Basado en el Ibanez Tube Screamer TS808: overdrive suave con un realce de medios característico. El empuje de ampli más famoso de la historia.", refs: [{ who: "Stevie Ray Vaughan", songs: ["«Pride and Joy»", "«Texas Flood»"] }, { who: "Kirk Hammett (Metallica), para empujar el ampli", songs: [] }], tip: "Truco clásico: Gain bajo, VOL alto, delante de un ampli ya saturado." },
    50331650: { desc: "Basado en el Boss OD-1 (1977), el primer overdrive de Boss: suave y con medios marcados.", refs: [] },
    50331654: { desc: "Basado en el Boss SD-1 Super OverDrive: primo del Tube Screamer, algo más brillante y con más ganancia.", refs: [{ who: "Zakk Wylde, para empujar sus Marshall en la época con Ozzy Osbourne", songs: [] }] },
    50331690: { desc: "Basado en el Boss DS-1: distorsión brillante y agresiva, uno de los pedales más vendidos de la historia.", refs: [{ who: "Kurt Cobain (Nirvana)", songs: ["«Smells Like Teen Spirit»"] }, { who: "Joe Satriani en sus primeros discos", songs: [] }] },
    50331689: { desc: "Basado en el MXR Distortion+: distorsión sencilla y rasposa de finales de los 70.", refs: [{ who: "Randy Rhoads (Ozzy Osbourne)", songs: ["«Crazy Train»"] }] },
    50331696: { desc: "Basado en el MI Audio Crunch Box: el sonido de un Marshall saturado metido en un pedal.", refs: [{ who: "Estilo: hard rock de los 70–80", songs: [] }] },
    50331691: { desc: "Basado en el ProCo RAT (chip LM308): distorsión gruesa que va del overdrive al casi fuzz. Ojo: su Filter oscurece al subirlo.", refs: [{ who: "Jeff Beck", songs: [] }, { who: "David Gilmour (Pink Floyd) en los 80–90", songs: [] }] },
    50331682: { desc: "Basado en el Sola Sound Tone Bender MkII: fuzz de germanio británico de los 60, más agresivo que el Fuzz Face.", refs: [{ who: "Jimmy Page en los primeros discos de Led Zeppelin", songs: [] }, { who: "Jeff Beck con The Yardbirds", songs: [] }] },
    50331684: { desc: "Basado en el Dallas-Arbiter Fuzz Face de germanio: fuzz cálido que se limpia al bajar el volumen de la guitarra.", refs: [{ who: "Jimi Hendrix", songs: ["«Purple Haze»", "«Foxy Lady»"] }], tip: "Baja el volumen de la guitarra a 6–7 para conseguir un crunch limpio." },
    50331712: { desc: "Basado en el Boss ODB-3, overdrive para bajo con mezcla de señal limpia para no perder graves.", refs: [] },
    // AMP
    117440513: { desc: "Fender Tweed Deluxe 5E3 (años 50): pequeño, de un solo tono, que satura pronto con un crunch cálido y desordenado.", refs: [{ who: "Neil Young", songs: ["«Cinnamon Girl»", "«Rockin' in the Free World»"] }], pair: "TWD CP 1x8 o un 1x12" },
    117440515: { desc: "Fender Bassman 5F6-A de 1959, entrada Normal: diseñado para bajo, se convirtió en un ampli de guitarra legendario y en la base del primer Marshall.", refs: [{ who: "Estilo: blues de Chicago y rock and roll", songs: [] }], pair: "Bellman 2x12" },
    117440516: { desc: "Fender Twin Reverb «blackface» de 1965: el limpio de referencia, con mucho margen antes de saturar y agudos cristalinos.", refs: [{ who: "Jerry Garcia (Grateful Dead)", songs: [] }, { who: "Eric Johnson, para sus limpios", songs: [] }, { who: "Estilo: country, funk, surf y jazz", songs: [] }], pair: "Dark Twin 2x12" },
    117440529: { desc: "VOX AC30, canal Normal: el «chime» británico de los 60, brillante y de medios ricos.", refs: [{ who: "The Beatles (época «Help!»)", songs: [] }, { who: "Hank Marvin (The Shadows)", songs: ["«Apache»"] }], pair: "Foxy 2x12 o Foxy 1x12" },
    117440532: { desc: "Roland Jazz Chorus JC-120: limpio de transistores, muy claro y frío, famoso por su chorus estéreo.", refs: [{ who: "Andy Summers (The Police)", songs: ["«Message in a Bottle»", "«Walking on the Moon»"] }, { who: "Robert Smith (The Cure)", songs: [] }], pair: "J-120 2x12" },
    117440533: { desc: "Matchless Chieftain: ampli boutique de clase A inspirado en el AC30, rico en armónicos.", refs: [], pair: "Foxy 2x12" },
    117440537: { desc: "Mesa/Boogie Lone Star, canal 1: limpio redondo y moderno con mucho cuerpo.", refs: [], pair: "L-Star 1x12" },
    117440554: { desc: "Marshall JTM45: el primer Marshall (1962), nacido de copiar el Bassman. Crunch cálido y redondo.", refs: [{ who: "Eric Clapton con los Bluesbreakers de John Mayall (el disco «Beano», 1966)", songs: ["«Hideaway»"] }], pair: "UK GRN 4x12 o UK GRN 2x12" },
    117440559: { desc: "Marshall JMP 50 con los canales puenteados («jumped»): el sonido Plexi del rock de los 70. Mezcla Gain 1 (oscuro) y Gain 2 (brillante).", refs: [{ who: "Familia de amplis del rock clásico: AC/DC, Jimi Hendrix y el primer Van Halen tocaron con Marshall de esta época", songs: ["«Back in Black» — AC/DC (estilo)"] }], pair: "UK GRN 4x12" },
    117440565: { desc: "Marshall JCM800 2203: el sonido del hard rock y el heavy de los 80, con medios agresivos.", refs: [{ who: "Slash (Guns N' Roses)", songs: ["«Welcome to the Jungle»", "«Sweet Child O' Mine»"] }, { who: "Zakk Wylde", songs: [] }], pair: "UK GRN 4x12" },
    117440548: { desc: "Fender Bassman 5F6-A de 1959, entrada Bright: más brillante y saturado que la Normal.", refs: [{ who: "Estilo: blues-rock", songs: [] }], pair: "Bellman 2x12" },
    117440551: { desc: "VOX AC30 Top Boost: el AC30 con más agudos y ganancia; brillante y con mucha presencia.", refs: [{ who: "Brian May (Queen)", songs: ["«Bohemian Rhapsody» (solo)"] }, { who: "The Edge (U2)", songs: ["«I Will Follow»"] }], pair: "Foxy 2x12" },
    117440552: { desc: "Supro Dual-Tone: ampli americano pequeño de los 60, que satura con un carácter crudo.", refs: [{ who: "Los Supro de válvulas forman parte del sonido de Jimmy Page en el primer disco de Led Zeppelin", songs: [] }], pair: "SUP Star 2x12" },
    117440583: { desc: "Soldano SLO-100, canal Crunch: un rugido de rock de los 80 muy definido.", refs: [{ who: "Eric Clapton (finales de los 80)", songs: [] }], pair: "Solo 4x12" },
    117440585: { desc: "Dr. Z Maz 38: boutique de clase A inspirado en el AC30, con crunch dinámico.", refs: [{ who: "Brad Paisley", songs: [] }], pair: "Foxy 2x12" },
    117440587: { desc: "Badcat Hot Cat: boutique de clase A con overdrive denso y rico en armónicos.", refs: [], pair: "UK GRN 2x12" },
    117440595: { desc: "Orange Rockerverb 100, canal sucio: ganancia gruesa y de medios grandes, típica del stoner, el doom y el metal moderno.", refs: [{ who: "Jim Root (Slipknot)", songs: [] }], pair: "Juice 4x12" },
    117440613: { desc: "Diezel VH4, canal 3: alta ganancia alemana muy definida y apretada.", refs: [{ who: "Adam Jones (Tool)", songs: ["«Schism»"] }], pair: "Dizz 4x12" },
    117440618: { desc: "Diezel VH4, canal 4: el canal más saturado del VH4, para solos y riffs extremos.", refs: [{ who: "Adam Jones (Tool)", songs: [] }], pair: "Dizz 4x12" },
    117440607: { desc: "ENGL Savage 120, canal 4: alta ganancia europea, agresiva y precisa.", refs: [{ who: "Estilo: metal europeo y power metal", songs: [] }], pair: "Eagle 4x12" },
    117440602: { desc: "Peavey 5150, canal Lead: el ampli de firma de Eddie Van Halen, base del metal y el metalcore de los 90 y 2000.", refs: [{ who: "Eddie Van Halen (discos de Van Halen desde «5150»)", songs: [] }, { who: "Estilo: metalcore", songs: [] }], pair: "EV 4x12" },
    117440601: { desc: "Soldano SLO-100, canal Overdrive: el canal de solos, con mucho sustain y suave.", refs: [{ who: "Estilo: solos de hard rock de los 80", songs: [] }], pair: "Solo 4x12" },
    117440616: { desc: "Mesa/Boogie Dual Rectifier, canal 3 en modo Vintage: alta ganancia con medios más presentes.", refs: [{ who: "Metallica y Foo Fighters en los 90", songs: [] }], pair: "Mess 4x12" },
    117440617: { desc: "Mesa/Boogie Dual Rectifier, canal 3 en modo Modern: graves enormes y medios recortados; el sonido del nu-metal.", refs: [{ who: "Estilo: nu-metal y metal de los 90–2000", songs: [] }], pair: "Mess 4x12" },
    117440611: { desc: "ENGL Powerball, canal 4: alta ganancia con graves muy apretados para metal moderno.", refs: [], pair: "Eagle 4x12" },
    117440605: { desc: "Friedman BE-100, canal HBE: el sonido de un Marshall modificado de los 80, llevado más lejos.", refs: [{ who: "Estilo: hard rock moderno", songs: [] }], pair: "UK GRN 4x12" },
    117440621: { desc: "Bogner Ecstasy, canal rojo (vintage): alta ganancia suave y musical.", refs: [], pair: "Bog 4x12" },
    117440627: { desc: "Ampeg SVT: el estándar del bajo de rock desde 1969.", refs: [{ who: "Los Rolling Stones lo estrenaron en su gira de 1969", songs: [] }], pair: "AMPG 4x10" },
    117440629: { desc: "VOX AC100: el ampli que usaron los Beatles en los grandes conciertos de 1965.", refs: [{ who: "The Beatles", songs: [] }], pair: "Bellman 2x12" },
    117440631: { desc: "Mesa/Boogie Bass 400+: bajo de válvulas con mucho cuerpo y saturación cálida.", refs: [], pair: "AMPG 4x10" },
    134217850: { desc: "Previo para guitarra acústica (tipo AER Colourizer) con EQ paramétrica, frecuencia 1.", refs: [] },
    134217851: { desc: "Previo para guitarra acústica (tipo AER Colourizer) con EQ paramétrica, frecuencia 2.", refs: [] },
    // CAB
    167772161: { desc: "1x8 tipo Fender Tweed Champ: pequeño y con pocos graves.", pair: "Tweedy" },
    167772164: { desc: "1x12 tipo Fender blackface (Vibrolux): limpio y abierto.", pair: "Dark Twin" },
    167772168: { desc: "1x12 tipo VOX con altavoz Celestion: brillante.", pair: "Foxy 30N / 30TB" },
    167772169: { desc: "1x12 tipo Mesa Lone Star: redondo y con cuerpo.", pair: "L-Star CL" },
    167772187: { desc: "2x12 tipo Fender: limpio con algo más de medios.", pair: "Dark Twin" },
    167772178: { desc: "2x12 del Fender Twin Reverb: abierto y cristalino.", pair: "Dark Twin" },
    167772185: { desc: "2x12 tipo Supro: medios crudos.", pair: "SUPDual OD" },
    167772177: { desc: "2x12 del Roland JC-120.", pair: "J-120 CL" },
    167772175: { desc: "2x12 del VOX AC30 con Celestion Blue: el «chime» británico.", pair: "Foxy 30N / 30TB" },
    167772179: { desc: "2x12 tipo Marshall con Celestion Greenback: medios cálidos.", pair: "UK 45, Bad-KT OD" },
    167772194: { desc: "4x12 Marshall 1960 con Celestion Greenback: el gabinete del rock británico.", pair: "UK 45, UK 50JP, UK 800" },
    167772197: { desc: "4x12 tipo Bogner: graves firmes y medios suaves.", pair: "Bog RedV" },
    167772206: { desc: "4x12 tipo Diezel: apretado y con mucha definición.", pair: "Dizz VH / VH+" },
    167772192: { desc: "4x12 tipo Peavey 5150: agresivo, para alta ganancia.", pair: "EV 51" },
    167772200: { desc: "4x12 tipo Soldano.", pair: "Solo100 OD / LD" },
    167772196: { desc: "4x12 Mesa Rectifier: graves enormes.", pair: "Mess DualV / DualM" },
    167772198: { desc: "4x12 tipo ENGL: moderno y apretado.", pair: "Eagle 120, Power LD" },
    167772201: { desc: "4x12 tipo Orange: medios grandes y graves gruesos.", pair: "Juice R100" },
    167772182: { desc: "2x12 tipo Bassman, válido para bajo y guitarra.", pair: "Bellman 59N / 59B" },
    167772216: { desc: "4x10 tipo Ampeg: el gabinete de bajo clásico.", pair: "Classic Bass" },
    // EQ
    16777269: { desc: "Ecualizador de 5 bandas pensado para guitarra." },
    16777270: { desc: "Ecualizador de 5 bandas para guitarra, con frecuencias algo más abiertas." },
    16777273: { desc: "Ecualizador de 5 bandas pensado para bajo." },
    16777274: { desc: "Ecualizador de 5 bandas para bajo, con más detalle en los medios-graves." },
    16777276: { desc: "Basado en el EQ gráfico de 5 bandas de los Mesa/Boogie. El clásico es la «V»: graves y agudos arriba y 750 Hz abajo.", refs: [{ who: "Estilo: el sonido «scooped» de Metallica en los 80", songs: ["«Master of Puppets» (estilo)"] }] },
    // MOD
    67108864: { desc: "Basado en el Arion SCH-1: chorus estéreo brillante de los 80.", refs: [{ who: "Estilo: limpios de los 80", songs: [] }] },
    67108872: { desc: "Basado en el Boss CE-2: el chorus analógico cálido por excelencia.", refs: [{ who: "Estilo: el chorus de «Come As You Are» de Nirvana (grabado con un EHX Small Clone)", songs: [] }] },
    67108881: { desc: "Flanger: barrido metálico tipo «avión a reacción».", refs: [{ who: "Eddie Van Halen (con un MXR Flanger)", songs: ["«Unchained»"] }] },
    67108883: { desc: "Flanger con otra respuesta: más suave y profundo.", refs: [] },
    67108889: { desc: "Basado en el MXR Phase 90: phaser de un solo mando, cálido y redondo.", refs: [{ who: "Eddie Van Halen", songs: ["«Eruption»", "«Ain't Talkin' 'bout Love»"] }] },
    67108895: { desc: "Basado en el Uni-Vibe (Voodoo Lab Micro Vibe): pulsación líquida a medio camino entre chorus y phaser.", refs: [{ who: "Jimi Hendrix", songs: ["«Machine Gun»"] }, { who: "Robin Trower", songs: ["«Bridge of Sighs»"] }, { who: "David Gilmour (Pink Floyd)", songs: ["«Breathe»"] }] },
    67108885: { desc: "Basado en el Boss VB-2: vibrato real (varía la afinación), cálido y analógico.", refs: [] },
    67108887: { desc: "Vibrato: modula la afinación de forma periódica.", refs: [] },
    67108897: { desc: "Basado en el Demeter Tremulator: trémolo óptico suave, como el de los amplis antiguos.", refs: [{ who: "Johnny Marr (The Smiths)", songs: ["«How Soon Is Now?»"] }] },
    67108902: { desc: "Trémolo de onda senoidal: subidas y bajadas de volumen suaves.", refs: [{ who: "Green Day", songs: ["«Boulevard of Broken Dreams» (intro)"] }] },
    67108904: { desc: "Trémolo «bias», como el de los Fender antiguos, con control de forma de onda.", refs: [{ who: "Estilo: surf, rockabilly y spaghetti western", songs: [] }] },
    // DLY
    184549376: { desc: "Delay digital limpio: repeticiones fieles a lo que tocas.", refs: [{ who: "The Edge (U2), con corchea con puntillo", songs: ["«Where the Streets Have No Name»"] }], tip: "Corchea con puntillo = (60000 ÷ BPM) × 0,75." },
    184549377: { desc: "Delay analógico: repeticiones cálidas y oscuras que se integran con el sonido.", refs: [{ who: "Estilo: solos de blues y rock", songs: [] }] },
    184549381: { desc: "Slapback: una única repetición muy corta, el eco del rockabilly de los 50.", refs: [{ who: "Scotty Moore (con Elvis Presley)", songs: ["«Mystery Train»"] }, { who: "Brian Setzer (Stray Cats)", songs: ["«Rock This Town»"] }] },
    184549389: { desc: "Basado en el Boss DM-2: delay analógico de los 80, cálido y algo modulado.", refs: [] },
    184549378: { desc: "Eco de cinta (tipo Echoplex o Space Echo): repeticiones que se degradan y ondulan.", refs: [{ who: "Brian May (Queen)", songs: ["«Brighton Rock» (solo)"] }] },
    184549387: { desc: "Delay con carácter de válvulas: repeticiones con algo de saturación.", refs: [] },
    184549395: { desc: "Eco invertido: las repeticiones suenan al revés, como una cinta reproducida hacia atrás.", refs: [{ who: "Estilo: psicodelia de los 60", songs: ["«I'm Only Sleeping» — The Beatles (guitarra al revés)"] }] },
    184549385: { desc: "Delay con modulador en anillo: repeticiones metálicas y experimentales.", refs: [] },
    184549382: { desc: "Delay con barrido de filtro sobre las repeticiones.", refs: [] },
    184549380: { desc: "Ping pong: las repeticiones saltan entre izquierda y derecha (se aprecia en estéreo, p. ej. con auriculares).", refs: [] },
    // RVB
    201326603: { desc: "Reverb «Air»: espacio abierto y suave.", refs: [] },
    201326592: { desc: "Habitación: reverb corta y natural.", refs: [{ who: "Estilo: rock y riffs, dar aire sin perder pegada", songs: [] }] },
    201326593: { desc: "Sala de conciertos: reverb amplia y envolvente.", refs: [{ who: "Estilo: solos melódicos y baladas", songs: [] }] },
    201326594: { desc: "Iglesia: cola muy larga y oscura.", refs: [] },
    201326608: { desc: "Placa larga: la reverb metálica y densa de los estudios de los 60–70.", refs: [] },
    201326607: { desc: "Placa: reverb de estudio brillante y densa.", refs: [] },
    201326596: { desc: "Muelle: la reverb de los amplis Fender, con su «boing» característico.", refs: [{ who: "Dick Dale", songs: ["«Misirlou»"] }, { who: "Estilo: surf", songs: [] }] },
    201326598: { desc: "Reverb brillante y espaciosa.", refs: [{ who: "Estilo: ambient y post-rock", songs: [] }] },
    201326599: { desc: "Reverb profunda y oscura, de cola larga.", refs: [{ who: "Estilo: ambient", songs: [] }] },
    201326613: { desc: "Reverb modulada: cola ancha y etérea.", refs: [{ who: "Estilo: ambient y shoegaze", songs: [] }] },
  };

  function model(fxid, block) {
    const m = MODELS[fxid];
    if (m) return m;
    if (block === "CAB" && (fxid & 0xffffff) >= 0x100000) return { desc: "Tu propia respuesta al impulso (IR), cargada con Valeton Suite." };
    if (block === "N->S") return { desc: "Una de tus capturas NAM (SnapTone)." };
    return null;
  }

  window.GuideData = { BLOCKS, param, model };
})();
