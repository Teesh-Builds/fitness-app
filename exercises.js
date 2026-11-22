/*
 * EXERCISE LIST: edit this file to change what people can pick in their plan.
 *
 * - Add, remove or rename options under any category.
 * - `id` must be unique. Once people have logged an exercise, don't change its id
 *   (their history points at it). Changing `name` is always safe.
 * - `video`: paste a specific how-to YouTube link, e.g. "https://www.youtube.com/watch?v=XXXX".
 *   Leave it as "" and the app links to a YouTube search for "how to do <name> proper form".
 *   Right now every video is "" (a search link), so these are all placeholders to swap out.
 * - `detail` (optional) shows under the name, e.g. treadmill settings.
 */
window.EXERCISE_LIBRARY = {
  blockWeeks: 12,        // length of one training block
  deloadWeeks: [6, 12],  // deload weeks inside each block
  defaultSets: 3,        // sets shown per exercise before the user adds more

  categories: [
    {
      key: "squat",
      label: "Squat",
      options: [
        { id: "leg-press", name: "Leg Press", video: "" },
        { id: "goblet-squat", name: "Goblet Squat", video: "" },
        { id: "pistol-squat", name: "Pistol Squat", video: "" },
        { id: "bulgarian-split-squat", name: "Bulgarian Split Squat", video: "" },
        { id: "single-leg-press", name: "Single Leg Press", video: "" },
        { id: "smith-machine-squat", name: "Smith Machine Squat", video: "" }
      ]
    },
    {
      key: "bend",
      label: "Bend",
      options: [
        { id: "glute-bridge", name: "Glute Bridge", video: "" },
        { id: "hip-thrust", name: "Hip Thrusts", video: "" },
        { id: "deadlift", name: "Deadlifts", video: "" },
        { id: "kettlebell-swing", name: "Kettlebell Swings", video: "" },
        { id: "back-extension", name: "Back Extensions", video: "" },
        { id: "glute-kickback", name: "Cable or Machine Glute Kickbacks", video: "" }
      ]
    },
    {
      key: "push",
      label: "Push",
      options: [
        { id: "overhead-press", name: "Overhead Press", video: "" },
        { id: "incline-press", name: "Incline Press", video: "" },
        { id: "flat-bench-press", name: "Flat Bench Press", video: "" }
      ]
    },
    {
      key: "pull",
      label: "Pull",
      options: [
        { id: "lat-pulldown", name: "Lat Pulldowns", video: "" },
        { id: "pull-up", name: "Pull Ups", video: "" },
        { id: "one-arm-db-row", name: "One Arm Dumbbell Rows", video: "" }
      ]
    },
    {
      key: "single",
      label: "Single Leg",
      options: [
        { id: "step-up", name: "Step Ups", video: "" },
        { id: "reverse-lunge", name: "Reverse Lunge", video: "" }
      ]
    },
    {
      key: "core",
      label: "Core",
      options: [
        { id: "dead-bug", name: "Dead Bug", video: "" },
        { id: "farmers-carry", name: "Farmers Carry", video: "" },
        { id: "weighted-crunch", name: "Weighted Crunches", video: "" }
      ]
    },
    {
      key: "cardio",
      label: "Cardio",
      type: "cardio",
      options: [
        { id: "stair-climber", name: "Stair Climber", video: "" },
        { id: "incline-treadmill", name: "Incline Treadmill Walk", detail: "Incline 8 · Speed 3", video: "" }
      ]
    }
  ]
};
