# Page breadcrumbs

[Documentation index](../README.md)

Synthetic fixture captured on 2026-09-27 in the real application shell at
1280×800, cropped to each page's header. The fixture has three made-up
questions, one bookmark and one wrong answer. No real exam content is shown.
The "before" images are from `master` at `0a35a13`.

Each Study and Resources page used to open with its own kicker. The setup
screens had an icon kicker ("Learning mode"), the lists had an uppercase
eyebrow ("Saved", "Targeted review"), and Knowledge points had a "Personal
library · Available across all exams" line as well. Mock's live screen had no
such row. Every page now opens with the same breadcrumb: the sidebar section,
then the page, with the page's nav icon.

| | Before | After |
|---|---|---|
| Learning setup | ![Learning setup before: "Learning mode" icon kicker](breadcrumbs/learning-setup-before.png) | ![Learning setup after: Study › Learning](breadcrumbs/learning-setup-after.png) |
| Practice setup | ![Practice setup before: "Free practice" icon kicker](breadcrumbs/practice-setup-before.png) | ![Practice setup after: Study › Practice](breadcrumbs/practice-setup-after.png) |
| Mock setup | ![Mock setup before: "Mock exam" icon kicker](breadcrumbs/mock-setup-before.png) | ![Mock setup after: Study › Mock exam](breadcrumbs/mock-setup-after.png) |
| Knowledge points | ![Knowledge points before: a "Personal library" line over a "Personal knowledge" eyebrow](breadcrumbs/knowledge-points-before.png) | ![Knowledge points after: Resources › Knowledge points with an "Available across all exams" pill](breadcrumbs/knowledge-points-after.png) |
| Bookmarks | ![Bookmarks before: "Saved" eyebrow](breadcrumbs/bookmarks-before.png) | ![Bookmarks after: Resources › Bookmarks](breadcrumbs/bookmarks-after.png) |
| Wrong questions | ![Wrong questions before: "Targeted review" eyebrow](breadcrumbs/wrong-before.png) | ![Wrong questions after: Resources › Wrong questions](breadcrumbs/wrong-after.png) |
| Annotations | ![Annotations before: "Review" eyebrow](breadcrumbs/annotations-before.png) | ![Annotations after: Resources › Annotations](breadcrumbs/annotations-after.png) |
| Learning session | ![Learning session before: "Learning · read-through" kicker](breadcrumbs/learning-live-before.png) | ![Learning session after: Study › Learning over the question number](breadcrumbs/learning-live-after.png) |
| Practice session | ![Practice session before: "Free practice" kicker](breadcrumbs/practice-live-before.png) | ![Practice session after: Study › Practice over the question number](breadcrumbs/practice-live-after.png) |
| Mock session | ![Mock session before: the timer bar with nothing above it](breadcrumbs/mock-live-before.png) | ![Mock session after: Study › Mock exam above the timer bar](breadcrumbs/mock-live-after.png) |

In the Dusk scheme the section stays muted and the page takes Dusk's accent:

![Learning setup in Dusk](breadcrumbs/learning-setup-dusk-after.png)

![Knowledge points in Dusk](breadcrumbs/knowledge-points-dusk-after.png)

At 390px the row wraps, and Knowledge points' pill moves to a second line.
During a Learning, Practice or Mock session a phone shows no breadcrumb,
because the top bar already names the mode.

<img src="breadcrumbs/learning-setup-phone-after.png" width="300" alt="Learning setup at 390px"> <img src="breadcrumbs/knowledge-points-phone-after.png" width="300" alt="Knowledge points at 390px, the pill on its own line">
