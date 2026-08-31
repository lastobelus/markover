def reviewed_blocks:
  [
    ..
    | objects
    | select((.id? // "") | startswith("block-"))
    | select(
        ((.feedback? // "") | length) > 0
        or (.sourceEdit? != null)
      )
    | { id }
      + (if ((.feedback? // "") | length) > 0
          then { feedback }
          else {}
        end)
      + (if ((.attachments? // []) | length) > 0
          then {
            attachments: [
              .attachments[] | { id, label }
            ]
          }
          else {}
        end)
      + (if .sourceEdit? != null
          then { sourceEdit }
          else {}
        end)
  ];

{
  review: { status: .review.status },
  blocks: reviewed_blocks
}
