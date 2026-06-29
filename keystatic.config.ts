import { config, fields, collection, singleton } from '@keystatic/core';

export default config({
  storage:
    process.env.NODE_ENV === 'production'
      ? { kind: 'cloud' }
      : { kind: 'local' },
  cloud: {
    project: 'gpizzinistm/natango-astro',
  },
  singletons: {
    settings: singleton({
      label: 'Impostazioni Generali',
      path: 'src/content/settings/general',
      schema: {
        siteName: fields.text({ label: 'Nome del Sito', defaultValue: 'Accademia Natango' }),
        heroTitle: fields.text({
          label: 'Titolo Hero',
          defaultValue: 'Scopri il mondo del tango argentino e immergiti in un’esperienza fatta di armonia, abbraccio e passione.',
          multiline: true,
        }),
        heroSubtitle: fields.text({
          label: 'Sottotitolo Hero',
          defaultValue: 'costruisci il tuo stile attraverso studio, eleganza e una didattica professionale pensata per valorizzare ogni ballerino.',
          multiline: true,
        }),
        email: fields.text({ label: 'Email di contatto', defaultValue: 'info@natango.org' }),
        phone: fields.text({ label: 'Telefono', defaultValue: '+39 339 273 7619' }),
        whatsappText: fields.text({
          label: 'Testo preimpostato WhatsApp',
          defaultValue: 'Ciao Natango, vorrei informazioni sui corsi',
        }),
        facebookUrl: fields.url({
          label: 'Link Facebook',
          defaultValue: 'https://www.facebook.com/natangoroma',
        }),
        instagramUrl: fields.url({
          label: 'Link Instagram',
          defaultValue: 'https://www.instagram.com/natangoroma/',
        }),
        youtubeUrl: fields.url({
          label: 'Link YouTube',
          defaultValue: 'https://www.youtube.com/@delbuonofrancesca',
        }),
      },
    }),
    schedule: singleton({
      label: 'Tabella Orari e Corsi',
      path: 'src/content/schedule/table',
      format: { data: 'json' },
      schema: {
        lessons: fields.array(
          fields.object({
            day: fields.select({
              label: 'Giorno',
              options: [
                { label: 'Lunedì', value: 'Lunedì' },
                { label: 'Martedì', value: 'Martedì' },
                { label: 'Mercoledì', value: 'Mercoledì' },
                { label: 'Giovedì', value: 'Giovedì' },
                { label: 'Venerdì', value: 'Venerdì' },
                { label: 'Sabato', value: 'Sabato' },
                { label: 'Domenica', value: 'Domenica' },
              ],
              defaultValue: 'Lunedì',
            }),
            time: fields.text({ label: 'Orario (es. 20:00 - 21:15)', defaultValue: '20:00 - 21:15' }),
            courseName: fields.text({ label: 'Nome Corso / Livello', defaultValue: 'Principianti' }),
            teacher: fields.text({ label: 'Maestro/i', defaultValue: 'Francesca Del Buono' }),
            location: fields.select({
              label: 'Sede',
              options: [
                { label: 'Tango Loft', value: 'Tango Loft' },
                { label: 'Gotan Club', value: 'Gotan Club' },
                { label: 'Entrambe / Online', value: 'Entrambe' },
              ],
              defaultValue: 'Tango Loft',
            }),
            info: fields.text({ label: 'Note extra (es. Lezione di prova)', defaultValue: '' }),
          }),
          {
            label: 'Lezioni',
            itemLabel: (item) => `${item.fields.day.value} - ${item.fields.time.value}: ${item.fields.courseName.value}`,
          }
        ),
      },
    }),
  },
  collections: {
    courses: collection({
      label: 'Presentazione Corsi',
      slugField: 'title',
      path: 'src/content/courses/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Titolo del Corso' } }),
        summary: fields.text({ label: 'Breve riassunto', multiline: true }),
        content: fields.markdoc({ label: 'Descrizione Completa' }),
      },
    }),
    locations: collection({
      label: 'Sedi dell\'Accademia',
      slugField: 'name',
      path: 'src/content/locations/*',
      format: { contentField: 'description' },
      schema: {
        name: fields.slug({ name: { label: 'Nome Sede (es. Mandrione)' } }),
        address: fields.text({ label: 'Indirizzo completo' }),
        mapsLink: fields.url({ label: 'Link Google Maps' }),
        description: fields.markdoc({ label: 'Dettagli Sede' }),
      },
    }),
  },
});
