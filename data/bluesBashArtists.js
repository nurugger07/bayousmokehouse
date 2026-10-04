// Berthoud Blues Bash lineup, in set order. Drives both the artist
// tiles and the schedule timeline from one source, so they can't drift
// out of sync with each other. If this event recurs, this file (or a
// copy of it) is the whole "update next year's lineup" surface.
//
// tileBio is the short, roughly-even-length blurb shown (clamped to 4
// lines) on the lineup tile. popupBio is the longer version shown in
// the artist modal -- more detail, but still meant to be skimmable
// rather than a full press bio. popupBio may contain multiple
// paragraphs separated by a blank line ('\n\n'); the modal renders
// each as its own <p> rather than collapsing them into a run-on block.
//
// musicUrl/websiteUrl are links to a song/video/playlist and the
// artist's own site -- most are null until Johnny supplies them; leave
// null rather than guessing a link, the template already handles a
// missing one by just not rendering that button in the artist modal.
//
// photoPosition sets the lineup tile's crop anchor (CSS object-position,
// vertical component only -- horizontal stays centered). Defaults to
// 'center'; override per artist when the default crop cuts off heads on
// a tall/close-up source photo.
//
// modalPhotoPosition is the same idea for the artist modal's (wider,
// shorter) photo crop, which needs its own anchor independent of the
// tile's -- defaults to 'top'; override per artist when 'top' crops
// too high and shows only the tops of heads.
module.exports = [
  {
    name: 'Mad Dog Blues Duo',
    photo: '/images/blues-bash/mad-dog-duo-pic1.jpg',
    photoPosition: 'center',
    tileBio:
      'Contemporary acoustic blues with an inventive edge. Guitarist Mark Kaczorowski and harmonica player Mad Dog Friedman breathe new life into the classic guitar-and-harmonica duo with original music rooted in traditional blues.',
    popupBio:
      'Mad Dog Blues Duo pairs guitarist Mark Kaczorowski with award-winning harmonica player Mad Dog Friedman for an inventive take on contemporary acoustic blues. Drawing from traditional blues while pushing the classic guitar-and-harmonica sound in fresh directions, the duo delivers original music with unmistakable chemistry.\n\nFriedman is the reigning Colorado Blues Society Colorado Blues Challenge Solo/Duo Champion, and the duo represented the Mile High Blues Society at the 2024 International Blues Challenge in Memphis. With numerous award-winning recordings and more than 2 million Spotify streams, Friedman and Kaczorowski bring serious blues credentials to a sound that still feels spontaneous, personal, and fun.',
    setStart: '12:30 PM',
    setEnd: '1:30 PM',
    isHeadliner: false,
    musicUrl: 'https://www.youtube.com/watch?v=TrI1mcEmg6E&list=PLR66Ns-dgQ-og_YDzoYwsHn0XkWYkCPH4&index=8',
    websiteUrl: 'https://coloradocountryblues.com/mdb_duo.htm',
  },
  {
    name: '100LB Housecat',
    photo: '/images/blues-bash/100lbhousecat_about_1-web.jpg',
    photoPosition: 'center',
    modalPhotoPosition: 'center',
    tileBio:
      '2025 International Blues Challenge semifinalists 100LB Housecat serve up a foot-stomping blend of original blues and soulful Americana that’s deeply rooted in the foundations of American music, but unmistakably their own.',
    popupBio:
      '2025 International Blues Challenge semifinalists 100LB Housecat pack plenty of punch with a foot-stomping mix of original blues and soulful Americana that feels pulled from another time yet perfectly at home in this one.\n\nMelly Frances pairs a striking, old-soul voice with bass, washboard, and stomp box, moving effortlessly from haunting vintage blues to a full-throated growl. Keke Lee answers with slide and Piedmont-style guitar inspired by legends like Tampa Red, Memphis Minnie, and Johnny Shines.\n\nBut 100LB Housecat isn’t a throwback act. Their thoughtful original songs draw on the foundations of American roots music while giving those traditions a distinctly modern voice.',
    setStart: '2:00 PM',
    setEnd: '3:00 PM',
    isHeadliner: false,
    musicUrl: 'https://www.youtube.com/watch?v=N4xKdgY_fQc&list=RDN4xKdgY_fQc',
    websiteUrl: 'https://www.100lbhousecat.com/',
  },
  {
    name: 'Delta Sonics',
    photo: '/images/blues-bash/delta-sonics-pic3.png',
    photoPosition: 'center',
    modalPhotoPosition: 'center',
    tileBio:
      'Led by award-winning harmonica player Al Chesis, the Delta Sonics blend Chicago blues with Swing, Delta, New Orleans R&B, and early rock ’n’ roll for a high-energy sound rooted in Colorado blues.',
    popupBio:
      'Led by vocalist and harmonica player Al Chesis, the Delta Sonics build on a Chicago blues foundation seasoned with Swing, Delta blues, New Orleans R&B, and early rock ’n’ roll. A longtime fixture of the Colorado blues scene, the band has performed hundreds of shows and appeared at major festivals throughout the region.\n\nChesis, a longtime Hohner endorser, is a recipient of the Colorado Blues Society Lifetime Achievement Award, while guitarist Bob Pellegrino is a three-time Society honoree for slide guitar. The Delta Sonics have opened for legends including B.B. King, Robert Cray, and Jimmie Vaughan, and backed artists including Pinetop Perkins, Bo Diddley, John Primer, and Ronnie Baker Brooks. They were also International Blues Challenge semifinalists in 2012.',
    setStart: '3:30 PM',
    setEnd: '4:30 PM',
    isHeadliner: false,
    musicUrl: 'https://www.youtube.com/watch?v=2WG-oAm8wGY',
    websiteUrl: 'https://deltasonics.net/',
  },
  {
    name: 'The Johnny O. Band',
    photo: '/images/blues-bash/johnny-o-trio-pic1.jpeg',
    photoPosition: 'top',
    tileBio:
      'A Colorado blues veteran with an international reach, Johnny O. blends blues, funk, New Orleans soul, and roots music into an infectious groove shaped by decades of performing across the U.S., Europe, and Brazil.',
    popupBio:
      'For decades, Johnny O. has been a fixture of the Colorado music scene, bringing together blues, funk, roots, and the unmistakable influence of New Orleans. Backed by longtime drummer Marion Edwards and internationally recognized bassist Andy Irvine, the Johnny O. Band delivers a tight, groove-driven live show built on decades of experience together.\n\nJohnny O.’s career has taken him across Europe and on multiple tours of Brazil, while his extensive catalog includes original music, reimagined blues classics, live recordings, and Brazilian-influenced instrumental work. A longtime student and friend of Chicago bluesman Howard Berkman, Johnny continues to carry his mentor’s influence forward while putting his own stamp on the music.',
    setStart: '5:00 PM',
    setEnd: '6:00 PM',
    isHeadliner: false,
    musicUrl: 'https://www.youtube.com/watch?v=YIZtW_1ZIVA',
    websiteUrl: 'https://johnnyoband.com/',
  },
  {
    name: 'The Jack Hadley Band',
    photo: '/images/blues-bash/jack-hadley-pic3-web.jpg',
    photoPosition: 'top',
    tileBio:
      'Guitarist and songwriter Jack Hadley brings blues tradition into the present with soulful vocals, powerful guitar work, and original music shaped by a career that has taken him from Colorado to stages around the world.',
    popupBio:
      'Guitarist, vocalist, and songwriter Jack Hadley has built a distinctive sound rooted in the blues while drawing from a lifetime of American music. In 2005, blues veteran Otis Taylor discovered Hadley performing in Colorado and brought him on as lead guitarist, launching 18 months of touring across the U.S., Canada, and the United Kingdom.\n\nHadley appears alongside Gary Moore and Charlie Musselwhite on Taylor’s Definition of a Circle and has performed everywhere from the BBC in London to Finland’s Rauma Blues Festival. His acclaimed projects include The St. Louis Sessions, the Langston Hughes-inspired Daybreak in Alabama, and his 2024 release, The St. Louis Sessions Volume II.',
    setStart: '6:30 PM',
    setEnd: '8:00 PM',
    isHeadliner: true,
    musicUrl: 'https://www.instagram.com/reels/C5hlyp2tpcX/',
    websiteUrl: 'https://jackhadleymusic.net/',
  },
];
