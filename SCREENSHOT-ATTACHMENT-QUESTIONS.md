# Screenshot attachments: first-cut decisions

Annotate any question where you want a different choice or need to add detail.
Leaving a question unannotated means the recommendation is accepted.

1. **Storage location.** Store pasted screenshots under a gitignored
   `.markover/attachments/` directory. This keeps them inside the workspace so
   the receiving agent can reliably access them. Should we use this location?

2. **Handoff portability.** Optimize for agents operating in the same workspace
   and emit file paths rather than base64 image data. This keeps the JSON small
   and gives the agent a real file it can inspect with image tools. Do we need
   copied review JSON to work on another machine in the first cut?

3. **Annotation representation.** Keep prose in the existing `feedback` string
   and add a separate `attachments` array to the selected node. Pasting an image
   should not insert a placeholder into the feedback text. Does that separation
   match how you expect agents to consume the review?

4. **Multiple screenshots.** Allow multiple images on one block, retain their
   paste order, and show each as a removable thumbnail below the feedback field.
   Clicking a thumbnail should open a larger preview. Is that enough attachment
   management for the first cut?

5. **Captions.** Do not add a dedicated caption field initially. Reviewers can
   refer to “the first screenshot” or “the second screenshot” in their feedback.
   Would captions provide enough immediate value to justify another input?

6. **Image editing.** Preserve clipboard images exactly, with no cropping,
   drawing, highlighting, or compression controls. Is raw paste sufficient for
   the happy-path prototype?

7. **Lifecycle.** Delete newly pasted files when a review is cancelled, but
   retain them after Done so the receiving agent can inspect them. Do we need
   any other cleanup behavior in the first cut?
